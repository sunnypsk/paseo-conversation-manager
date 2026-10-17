import { randomBytes } from "node:crypto";
import type { ArchiveResult, CleanupRule, Conversation, Filters, PlanItem, RunReport } from "../shared/types";
import { activityTime, filterConversations, planCleanup } from "../shared/planner";
import { fetchConversations, type ArchiveApi, type ConversationSnapshot } from "./snapshot";

export interface AutomationPreferences { automatic: boolean; rule: CleanupRule; projectIds: string[] }
export interface PreviewInput { selectedIds: string[]; filters: Filters; rule: CleanupRule | null }
export interface ArchiveRunState {
  status: "running" | "complete" | "failed";
  report: RunReport | null;
  error: string | null;
}
interface ArchiveJob { state: ArchiveRunState; promise: Promise<RunReport> }
interface Preview {
  expiresAt: number;
  input: PreviewInput;
  candidates: Conversation[];
  fingerprints: Map<string, string>;
}

const ALL_FILTERS: Filters = { query: "", projectId: "", status: "all" };
const PREVIEW_TTL = 5 * 60 * 1000;

function item(conversation: Conversation): PlanItem {
  return { id: conversation.id, title: conversation.title, projectName: conversation.projectName, activityAt: conversation.activityAt };
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export class CleanupEngine {
  private previews = new Map<string, Preview>();
  private busy = false;
  private closed = false;
  private lifetime = new AbortController();
  private report: RunReport | null = null;
  private jobs = new Map<string, ArchiveJob>();
  private activeRunId: string | null = null;

  constructor(
    private readonly readPreferences: () => Promise<AutomationPreferences | null>,
    private readonly now: () => number = Date.now,
  ) {}

  get lastRun(): RunReport | null { return this.report ? structuredClone(this.report) : null; }

  close(): void {
    this.closed = true;
    this.lifetime.abort();
    this.previews.clear();
  }

  private assertOpen(): void { if (this.closed) throw new Error("Conversation Manager has stopped."); }

  async list(paseo: ArchiveApi) {
    this.assertOpen();
    const snapshot = await fetchConversations(paseo, this.lifetime.signal);
    return { conversations: snapshot.conversations, lastRun: this.lastRun, activeRunId: this.activeRunId };
  }

  async preview(paseo: ArchiveApi, input: PreviewInput) {
    this.assertOpen();
    for (const [token, preview] of this.previews) if (preview.expiresAt <= this.now()) this.previews.delete(token);
    const snapshot = await fetchConversations(paseo, this.lifetime.signal);
    this.assertOpen();
    const savedInput: PreviewInput = structuredClone(input);
    const filtered = filterConversations(snapshot.conversations, input.filters);
    const selected = new Set(input.selectedIds);
    const scope = input.rule ? filtered : filtered.filter((conversation) => selected.has(conversation.id));
    const candidates = input.rule
      ? planCleanup(snapshot.conversations, input.filters, input.rule, this.now())
      : scope.filter((conversation) => !conversation.protection && activityTime(conversation) !== null);
    const expiresAt = this.now() + PREVIEW_TTL;
    const token = randomBytes(32).toString("hex");
    while (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(token, { expiresAt, input: savedInput, candidates: structuredClone(candidates), fingerprints: snapshot.fingerprints });
    return {
      token, expiresAt: new Date(expiresAt).toISOString(), items: candidates.map(item),
      protectedCount: scope.filter((conversation) => conversation.protection || activityTime(conversation) === null).length,
    };
  }

  async execute(paseo: ArchiveApi, token: string): Promise<RunReport> {
    const { runId } = this.start(paseo, token);
    return this.jobs.get(runId)!.promise;
  }

  /** Starts promptly; SDK plugin RPCs have a finite timeout, so callers poll getRun. */
  start(paseo: ArchiveApi, token: string): { runId: string } {
    this.assertOpen();
    if (this.busy) throw new Error("Another archive batch is running. Wait for it to finish; your preview is still valid.");
    const preview = this.previews.get(token);
    this.previews.delete(token); // Tokens are one-shot, including failed or expired attempts.
    if (!preview || preview.expiresAt <= this.now()) throw new Error("This preview has expired or has already been used. Create a new preview.");
    this.busy = true;
    return { runId: this.launch(() => this.run(paseo, preview, "manual")) };
  }

  getRun(runId: string): ArchiveRunState {
    const job = this.jobs.get(runId);
    if (!job) return { status: "failed", report: null, error: "This run is no longer available. Refresh to check the latest results." };
    return structuredClone(job.state);
  }

  private launch(run: () => Promise<RunReport>): string {
    const runId = randomBytes(24).toString("hex");
    const state: ArchiveRunState = { status: "running", report: null, error: null };
    this.activeRunId = runId;
    const promise = Promise.resolve().then(run).then((report) => {
      state.status = "complete";
      state.report = report;
      return report;
    }, (error: unknown) => {
      state.status = "failed";
      state.error = errorMessage(error);
      throw error;
    }).finally(() => {
      this.busy = false;
      if (this.activeRunId === runId) this.activeRunId = null;
    });
    while (this.jobs.size >= 20) this.jobs.delete(this.jobs.keys().next().value!);
    this.jobs.set(runId, { state, promise });
    void promise.catch(() => {}); // Detached RPC jobs expose failures through getRun.
    return runId;
  }

  async runAutomatic(paseo: ArchiveApi, signal?: AbortSignal): Promise<RunReport | null> {
    if (this.closed || this.busy || signal?.aborted) return null;
    // Acquire before reading settings so concurrent turn-ended callbacks cannot overlap.
    this.busy = true;
    try {
      const settings = await this.readPreferences();
      if (!settings?.automatic || this.closed || signal?.aborted) return null;
      const snapshot = await fetchConversations(paseo, this.lifetime.signal);
      const projectIds = new Set(settings.projectIds);
      const candidates = planCleanup(snapshot.conversations, ALL_FILTERS, settings.rule, this.now())
        .filter((conversation) => projectIds.size === 0 || projectIds.has(conversation.projectId));
      if (candidates.length === 0) return null;
      const preview: Preview = {
        expiresAt: this.now() + PREVIEW_TTL,
        input: { selectedIds: [], filters: ALL_FILTERS, rule: structuredClone(settings.rule) },
        candidates, fingerprints: snapshot.fingerprints,
      };
      const runId = this.launch(() => this.run(paseo, preview, "automatic", signal));
      return await this.jobs.get(runId)!.promise;
    } finally { this.busy = false; }
  }

  private async run(paseo: ArchiveApi, preview: Preview, source: RunReport["source"], signal?: AbortSignal): Promise<RunReport> {
    const startedAt = new Date(this.now()).toISOString();
    const results: ArchiveResult[] = [];
    for (const candidate of preview.candidates) {
      const result = (outcome: ArchiveResult["outcome"], detail: string): ArchiveResult => ({
        id: candidate.id, title: candidate.title, outcome, detail,
      });
      if (this.closed || signal?.aborted) {
        results.push(result("skipped", "Operation stopped"));
        continue;
      }
      try {
        let currentSettings: AutomationPreferences | null = null;
        if (source === "automatic") {
          currentSettings = await this.readPreferences();
          if (!currentSettings?.automatic) { results.push(result("skipped", "Automatic cleanup is disabled")); continue; }
        }
        const snapshot = await fetchConversations(paseo, this.lifetime.signal);
        const current = snapshot.conversations.find((conversation) => conversation.id === candidate.id);
        const reason = this.revalidate(candidate, current, preview, snapshot, currentSettings);
        if (reason) { results.push(result("skipped", reason)); continue; }
        // Re-read after network work so switching automatic off takes effect before the next archive.
        if (source === "automatic") {
          const settings = await this.readPreferences();
          if (!settings?.automatic || JSON.stringify(settings) !== JSON.stringify(currentSettings)) {
            results.push(result("skipped", "Automatic cleanup settings have changed")); continue;
          }
        }
        if (this.closed || signal?.aborted) { results.push(result("skipped", "Operation stopped")); continue; }
        const archived = await paseo.workspaces.archive(candidate.id);
        if (archived.error || !archived.archivedAt) {
          results.push(result("failed", archived.error || "Paseo did not confirm that archiving succeeded"));
        } else {
          results.push(result("archived", "Archived"));
        }
      } catch (error) {
        results.push(result(this.closed || signal?.aborted ? "skipped" : "failed", errorMessage(error)));
      }
    }
    const report: RunReport = { startedAt, completedAt: new Date(this.now()).toISOString(), source, results };
    this.report = report;
    return structuredClone(report);
  }

  private revalidate(
    candidate: Conversation, current: Conversation | undefined, preview: Preview,
    snapshot: ConversationSnapshot, settings: AutomationPreferences | null,
  ): string | null {
    if (!current) return "Conversation no longer exists or is already archived";
    if (current.protection) return current.protection;
    if (activityTime(current) === null) return "Last activity is unknown";
    if (snapshot.fingerprints.get(candidate.id) !== preview.fingerprints.get(candidate.id)) return "Conversation has changed. Create a new preview.";
    if (settings && settings.projectIds.length > 0 && !settings.projectIds.includes(current.projectId)) return "Project is no longer included in automatic cleanup";
    const rule = settings?.rule ?? preview.input.rule;
    const eligible = rule
      ? planCleanup(snapshot.conversations, preview.input.filters, rule, this.now())
      : filterConversations(snapshot.conversations, preview.input.filters).filter((conversation) => preview.input.selectedIds.includes(conversation.id));
    if (!eligible.some((conversation) => conversation.id === candidate.id)) return "Conversation no longer matches the preview scope or retention rules";
    return null;
  }
}
