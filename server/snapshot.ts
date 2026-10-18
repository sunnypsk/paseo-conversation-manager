import { createHash } from "node:crypto";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Conversation } from "../shared/types";
import { compareActivity } from "../shared/planner";

// Derive SDK types through the host-provided plugin module so Git installs do
// not need development dependencies for Paseo's import-boundary validation.
type PaseoApi = PluginHandlerContext["paseo"];
type PaseoWorkspaceListOptions = Parameters<PaseoApi["workspaces"]["list"]>[0];
type PaseoWorkspaceListResult = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>;
type PaseoWorkspaceArchiveResult = Awaited<ReturnType<PaseoApi["workspaces"]["archive"]>>;
type PaseoWorkspace = PaseoWorkspaceListResult["entries"][number];
type PaseoAgentListOptions = Parameters<PaseoApi["agents"]["list"]>[0];
type PaseoAgentListResult = Awaited<ReturnType<PaseoApi["agents"]["list"]>>;
type PaseoAgent = PaseoAgentListResult["entries"][number]["agent"];

export interface ArchiveApi {
  workspaces: {
    list(options?: PaseoWorkspaceListOptions): Promise<Pick<PaseoWorkspaceListResult, "entries" | "pageInfo">>;
    archive(id: string): Promise<Pick<PaseoWorkspaceArchiveResult, "archivedAt" | "error">>;
  };
  agents: {
    list(options?: PaseoAgentListOptions): Promise<Pick<PaseoAgentListResult, "entries" | "pageInfo">>;
  };
}

export interface ConversationSnapshot {
  conversations: Conversation[];
  fingerprints: Map<string, string>;
}

interface Page<T> { entries: T[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }

export async function readAllPages<T>(
  read: (cursor?: string) => Promise<Page<T>>,
  signal?: AbortSignal,
): Promise<T[]> {
  const entries: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 10000; pageNumber++) {
    if (signal?.aborted) throw new Error("Conversation loading canceled.");
    const page = await read(cursor);
    if (signal?.aborted) throw new Error("Conversation loading canceled.");
    entries.push(...page.entries);
    if (entries.length > 100000) throw new Error("Too many conversations to load safely.");
    if (!page.pageInfo.hasMore) return entries;
    const next = page.pageInfo.nextCursor;
    if (!next || seenCursors.has(next)) throw new Error("Invalid repeated pagination cursor; no archive was started.");
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("Pagination limit exceeded; no archive was started.");
}

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function latestActivity(workspace: PaseoWorkspace, agents: PaseoAgent[]): string | null {
  // Older hosts can omit workspace activity even when agent activity is available.
  // Nullable dates are absent information; a present malformed date is uncertain.
  const times: number[] = [];
  if (workspace.activityAt !== null && workspace.activityAt !== undefined) {
    const workspaceTime = validTime(workspace.activityAt);
    if (workspaceTime === null) return null;
    times.push(workspaceTime);
  }
  for (const agent of agents) {
    let hasAgentActivity = false;
    for (const value of [agent.updatedAt, agent.lastUserMessageAt, agent.attentionTimestamp, agent.activeTurn?.startedAt]) {
      if (value === null || value === undefined) continue;
      const time = validTime(value);
      if (time === null) return null;
      hasAgentActivity = true;
      times.push(time);
    }
    if (!hasAgentActivity) return null;
  }
  if (times.length === 0) return null;
  return new Date(times.reduce((latest, time) => Math.max(latest, time))).toISOString();
}

function protection(workspace: PaseoWorkspace, agents: PaseoAgent[], activityAt: string | null): string | null {
  if (workspace.workspaceKind === "worktree" || workspace.gitRuntime?.isPaseoOwnedWorktree ||
    workspace.project?.checkout.isPaseoOwnedWorktree) return "Worktree: archiving may remove the working directory";
  if (workspace.pinnedAt) return "Pinned";
  if (workspace.archivingAt) return "Archiving";
  if (workspace.scripts.some((script) => script.lifecycle === "running")) return "Workspace service is running";
  if (workspace.status === "running" || agents.some((agent) =>
    agent.status === "running" || agent.status === "initializing" || agent.activeTurn)) return "Running";
  if (workspace.status === "needs_input" || agents.some((agent) => agent.pendingPermissions.length > 0 ||
    agent.attentionReason === "permission")) return "Waiting for your response";
  if (activityAt === null) return "Last activity is unknown";
  return null;
}

export async function fetchConversations(paseo: ArchiveApi, signal?: AbortSignal): Promise<ConversationSnapshot> {
  const [workspaces, agentEntries] = await Promise.all([
    readAllPages((cursor) => paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } }), signal),
    readAllPages((cursor) => paseo.agents.list({
      filter: { includeArchived: false }, page: { limit: 200, ...(cursor ? { cursor } : {}) }, signal,
    }), signal),
  ]);
  const agentsByWorkspace = new Map<string, PaseoAgent[]>();
  const seenAgents = new Set<string>();
  for (const { agent } of agentEntries) {
    if (seenAgents.has(agent.id)) throw new Error("Agent list changed during loading; refresh and try again.");
    seenAgents.add(agent.id);
    if (!agent.workspaceId || agent.archivedAt) continue;
    const group = agentsByWorkspace.get(agent.workspaceId) ?? [];
    group.push(agent);
    agentsByWorkspace.set(agent.workspaceId, group);
  }
  const conversations: Conversation[] = [];
  const fingerprints = new Map<string, string>();
  for (const workspace of workspaces) {
    if (fingerprints.has(workspace.id)) throw new Error("Conversation list changed during loading; refresh and try again.");
    const agents = (agentsByWorkspace.get(workspace.id) ?? []).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const activityAt = latestActivity(workspace, agents);
    const conversation: Conversation = {
      id: workspace.id, projectId: workspace.projectId,
      projectName: workspace.projectCustomName || workspace.projectDisplayName,
      title: workspace.title || workspace.name || "Untitled conversation",
      directory: workspace.workspaceDirectory || workspace.projectRootPath,
      status: workspace.status, activityAt,
      protection: protection(workspace, agents, activityAt),
    };
    // Detect activity and membership changes even when the workspace activity field lags.
    const fingerprint = createHash("sha256").update(JSON.stringify({
      conversation, workspaceActivityAt: workspace.activityAt,
      agents: agents.map((agent) => ({
        id: agent.id, updatedAt: agent.updatedAt, lastUserMessageAt: agent.lastUserMessageAt,
        status: agent.status, activeTurn: agent.activeTurn ?? null,
        attentionReason: agent.attentionReason ?? null, attentionTimestamp: agent.attentionTimestamp ?? null,
        pendingPermissions: agent.pendingPermissions.map((permission) => permission.id).sort(),
      })),
    })).digest("hex");
    fingerprints.set(workspace.id, fingerprint);
    conversations.push(conversation);
  }
  return { conversations: conversations.sort(compareActivity), fingerprints };
}
