import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import type { CleanupRule, Conversation, Filters } from "../shared/types";
import { filterConversations, planCleanup } from "../shared/planner";
import { CleanupEngine, type AutomationPreferences } from "./engine";
import { fetchConversations, readAllPages, type ArchiveApi } from "./snapshot";

const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const DAY = 86400000;
const ALL: Filters = { query: "", projectId: "", status: "all" };
const old = (days = 40) => new Date(NOW - days * DAY).toISOString();
const RULE: CleanupRule = { olderThanDays: 30, keepPerProject: 1 };
function row(id: string, days = 40, projectId = "project-a", extra: Partial<Conversation> = {}): Conversation {
  return { id, projectId, projectName: projectId, title: id, directory: "/shared/project", status: "done", activityAt: old(days), protection: null, ...extra };
}
function workspace(id: string, days = 40, extra: Partial<PaseoWorkspace> = {}): PaseoWorkspace {
  return {
    id, projectId: "project-a", projectDisplayName: "Project A", projectRootPath: "/shared/project",
    projectKind: "git", workspaceKind: "directory", name: id, status: "done", activityAt: old(days),
    statusEnteredAt: null, scripts: [], ...extra,
  } as PaseoWorkspace;
}
function agent(id: string, workspaceId: string, extra: Partial<PaseoAgent> = {}): PaseoAgent {
  return {
    id, workspaceId, status: "idle", updatedAt: old(), lastUserMessageAt: null,
    pendingPermissions: [], ...extra,
  } as PaseoAgent;
}

function fake(workspaces: PaseoWorkspace[], agents: PaseoAgent[] = [], pageSize = 2) {
  const state = {
    workspaces, agents, archived: [] as string[], workspacePages: [] as (string | undefined)[],
    agentPages: [] as (string | undefined)[],
    onArchive: null as null | ((id: string) => Promise<{ archivedAt: string | null; error: string | null }>),
  };
  const page = <T>(entries: T[], cursor?: string) => {
    const start = cursor ? Number(cursor) : 0;
    const end = start + pageSize;
    return { entries: structuredClone(entries.slice(start, end)), pageInfo: { hasMore: end < entries.length, nextCursor: end < entries.length ? String(end) : null, prevCursor: null } };
  };
  const api: ArchiveApi = {
    workspaces: {
      async list(options) { state.workspacePages.push(options?.page?.cursor); return page(state.workspaces, options?.page?.cursor); },
      async archive(id) {
        state.archived.push(id);
        if (state.onArchive) return state.onArchive(id);
        state.workspaces = state.workspaces.filter((entry) => entry.id !== id);
        return { archivedAt: new Date(NOW).toISOString(), error: null };
      },
    },
    agents: {
      async list(options) {
        assert.equal(options?.filter?.includeArchived, false);
        state.agentPages.push(options?.page?.cursor);
        return page(state.agents.map((entry) => ({ agent: entry, project: {
          projectKey: "project-a", projectName: "Project A", checkout: {
            cwd: "/shared/project", isGit: false as const, worktreeRoot: null, currentBranch: null,
            remoteUrl: null, isPaseoOwnedWorktree: false as const, mainRepoRoot: null,
          },
        } })), options?.page?.cursor);
      },
    },
  };
  return { state, api };
}
function engine(settings: AutomationPreferences | null = null) {
  let current = settings;
  let now = NOW;
  return {
    engine: new CleanupEngine(async () => current, () => now),
    setSettings(value: AutomationPreferences | null) { current = value; },
    setNow(value: number) { now = value; },
  };
}
async function manualPreview(instance: CleanupEngine, api: ArchiveApi, ids: string[]) {
  return instance.preview(api, { selectedIds: ids, filters: ALL, rule: null });
}

test("search narrows candidates while keep N counts the complete project", () => {
  const rows = [row("newest", 1), row("find-me", 40), row("oldest", 50), row("project-b-newest", 2, "project-b"), row("project-b-old", 80, "project-b")];
  assert.deepEqual(planCleanup(rows, { ...ALL, query: "find-me" }, RULE, NOW).map((entry) => entry.id), ["find-me"]);
  assert.deepEqual(planCleanup(rows, ALL, RULE, NOW).map((entry) => entry.id), ["find-me", "oldest", "project-b-old"]);
  assert.deepEqual(filterConversations(rows, { ...ALL, projectId: "project-b" }).map((entry) => entry.id), ["project-b-newest", "project-b-old"]);
});

test("age is strictly elapsed days; both rules must match and empty rules do nothing", () => {
  const rows = [row("newest-but-old", 31), row("boundary", 30), row("just-over", 30 + 1 / DAY), row("ancient", 100)];
  assert.deepEqual(planCleanup(rows, ALL, { ...RULE, keepPerProject: 2 }, NOW).map((entry) => entry.id), ["newest-but-old", "ancient"]);
  assert.deepEqual(planCleanup(rows, ALL, { olderThanDays: 30, keepPerProject: null }, NOW).map((entry) => entry.id), ["just-over", "newest-but-old", "ancient"]);
  assert.deepEqual(planCleanup(rows, ALL, { olderThanDays: null, keepPerProject: null }, NOW), []);
});

test("equal dates use ID tie break, protected rows count for retention and unknown dates never archive", () => {
  const rows = [row("c"), row("b"), row("a", 40, "project-a", { protection: "Pinned" }), row("unknown", 50, "project-b", { activityAt: null }), row("invalid", 50, "project-b", { activityAt: "not-a-date" })];
  assert.deepEqual(planCleanup(rows, ALL, { olderThanDays: null, keepPerProject: 1 }, NOW).map((entry) => entry.id), ["b", "c"]);
  assert.deepEqual(planCleanup(rows, ALL, { olderThanDays: -1, keepPerProject: null }, NOW), []);
  const withUnknown = [row("unknown", 1, "project-a", { activityAt: null }), ...Array.from({ length: 7 }, (_, index) => row(`known-${index}`, index + 1))];
  assert.deepEqual(planCleanup(withUnknown, ALL, { olderThanDays: null, keepPerProject: 5 }, NOW).map((entry) => entry.id), ["known-5", "known-6"]);
});

test("snapshot follows workspace and agent pagination and uses most recent agent activity", async () => {
  const { api, state } = fake([workspace("a"), workspace("b"), workspace("c")], [agent("1", "a"), agent("2", "b"), agent("3", "c", { status: "running", updatedAt: old(1) })]);
  const snapshot = await fetchConversations(api);
  assert.deepEqual(state.workspacePages, [undefined, "2"]);
  assert.deepEqual(state.agentPages, [undefined, "2"]);
  assert.equal(snapshot.conversations.find((entry) => entry.id === "c")?.activityAt, old(1));
  assert.equal(snapshot.conversations.find((entry) => entry.id === "c")?.protection, "Running");
});

test("missing workspace activity falls back to reliable agent dates while unknown or malformed dates stay protected", async () => {
  const { api } = fake([
    workspace("fallback", 40, { activityAt: null }),
    workspace("message-fallback", 40, { activityAt: null }),
    workspace("no-dates", 40, { activityAt: null }),
    workspace("agent-no-dates", 40, { activityAt: null }),
    workspace("malformed-workspace", 40, { activityAt: "invalid" }),
    workspace("malformed-agent", 40, { activityAt: null }),
  ], [
    agent("fallback-agent", "fallback", { updatedAt: old(12), lastUserMessageAt: old(10), attentionTimestamp: null }),
    agent("message-agent", "message-fallback", { updatedAt: undefined as unknown as string, lastUserMessageAt: old(8) }),
    agent("no-date-agent", "agent-no-dates", { updatedAt: undefined as unknown as string, lastUserMessageAt: null }),
    agent("valid-agent", "malformed-workspace"),
    agent("malformed-agent", "malformed-agent", { updatedAt: "invalid", lastUserMessageAt: old(2) }),
  ]);
  const snapshot = await fetchConversations(api);
  const fallback = snapshot.conversations.find((entry) => entry.id === "fallback");
  assert.equal(fallback?.activityAt, old(10));
  assert.equal(fallback?.protection, null);
  assert.equal(snapshot.conversations.find((entry) => entry.id === "message-fallback")?.activityAt, old(8));
  const { engine: instance } = engine();
  const preview = await manualPreview(instance, api, snapshot.conversations.map((entry) => entry.id));
  assert.deepEqual(preview.items.map((entry) => entry.id), ["message-fallback", "fallback"]);
  assert.equal(preview.protectedCount, 4);
});

test("all owned worktrees, live work and unknown dates are protected; dirty shared directory is eligible", async () => {
  const rows = [
    workspace("worktree", 40, { workspaceKind: "worktree" }),
    workspace("owned", 40, { gitRuntime: { isPaseoOwnedWorktree: true } }),
    workspace("pinned", 40, { pinnedAt: old(1) }),
    workspace("archiving", 40, { archivingAt: old(1) }),
    workspace("running", 40, { status: "running" }),
    workspace("input", 40, { status: "needs_input" }),
    workspace("pending"), workspace("active"), workspace("initializing"),
    workspace("service", 40, { scripts: [{ lifecycle: "running" }] as PaseoWorkspace["scripts"] }),
    workspace("null", 40, { activityAt: null }), workspace("invalid", 40, { activityAt: "invalid" }),
    workspace("invalid-agent"),
    workspace("dirty", 40, { gitRuntime: { isPaseoOwnedWorktree: false, isDirty: true } }),
  ];
  const { api } = fake(rows, [
    agent("p", "pending", { pendingPermissions: [{ id: "permission" }] as PaseoAgent["pendingPermissions"] }),
    agent("a", "active", { activeTurn: { turnId: "turn", startedAt: old(1) } }),
    agent("i", "initializing", { status: "initializing" }),
    agent("invalid", "invalid-agent", { updatedAt: "invalid" }),
  ]);
  const { engine: instance } = engine();
  const preview = await manualPreview(instance, api, rows.map((entry) => entry.id));
  assert.deepEqual(preview.items.map((entry) => entry.id), ["dirty"]);
  assert.equal(preview.protectedCount, 13);
});

test("repeated or missing pagination cursor and duplicate entries fail closed", async () => {
  await assert.rejects(readAllPages(async () => ({ entries: [], pageInfo: { hasMore: true, nextCursor: "same" } })), /repeated pagination cursor/);
  await assert.rejects(readAllPages(async () => ({ entries: [], pageInfo: { hasMore: true, nextCursor: null } })), /pagination cursor/);
  const { api } = fake([workspace("same"), workspace("same")]);
  await assert.rejects(fetchConversations(api), /list changed/);
});

test("manual preview is immutable, one-shot and expires after five minutes", async () => {
  const { api, state } = fake([workspace("a"), workspace("b")]);
  const control = engine();
  const input = { selectedIds: ["a"], filters: { ...ALL }, rule: null };
  const preview = await control.engine.preview(api, input);
  input.selectedIds.push("b");
  input.filters.query = "changed";
  await control.engine.execute(api, preview.token);
  assert.deepEqual(state.archived, ["a"]);
  await assert.rejects(control.engine.execute(api, preview.token), /expired or has already been used/);
  const expired = await manualPreview(control.engine, api, ["b"]);
  control.setNow(NOW + 5 * 60 * 1000);
  await assert.rejects(control.engine.execute(api, expired.token), /expired or has already been used/);
});

test("activity, project, agent membership and new protections invalidate preview", async () => {
  const changes: ((state: ReturnType<typeof fake>["state"]) => void)[] = [
    (state) => { state.workspaces[0]!.activityAt = old(2); },
    (state) => { state.workspaces[0]!.projectId = "moved"; },
    (state) => { state.agents.push(agent("new", "a")); },
    (state) => { state.workspaces[0]!.pinnedAt = old(1); },
    (state) => { state.workspaces[0]!.activityAt = null; },
  ];
  for (const change of changes) {
    const { api, state } = fake([workspace("a")]);
    const { engine: instance } = engine();
    const preview = await manualPreview(instance, api, ["a"]);
    change(state);
    const report = await instance.execute(api, preview.token);
    assert.equal(report.results[0]?.outcome, "skipped");
    assert.deepEqual(state.archived, []);
  }
});

test("rule execution never adds candidates and rechecks promoted retained rows before each archive", async () => {
  const { api, state } = fake([workspace("newest", 1), workspace("middle", 40), workspace("oldest", 50)]);
  const { engine: instance } = engine();
  const preview = await instance.preview(api, { selectedIds: [], filters: ALL, rule: RULE });
  state.workspaces.push(workspace("newly-eligible", 80));
  state.onArchive = async (id) => {
    state.workspaces = state.workspaces.filter((entry) => entry.id !== id && entry.id !== "newest");
    return { archivedAt: old(0), error: null };
  };
  const report = await instance.execute(api, preview.token);
  assert.deepEqual(state.archived, ["middle"]);
  assert.deepEqual(report.results.map((entry) => entry.outcome), ["archived", "skipped"]);
  assert.ok(state.workspaces.some((entry) => entry.id === "newly-eligible"));
});

test("Paseo error, missing confirmation and exceptions fail individually without ending the batch", async () => {
  const { api, state } = fake([workspace("a"), workspace("b"), workspace("c"), workspace("d")]);
  state.onArchive = async (id) => {
    if (id === "a") return { archivedAt: old(0), error: "Archive failed" };
    if (id === "b") return { archivedAt: null, error: null };
    if (id === "c") throw new Error("Offline");
    return { archivedAt: old(0), error: null };
  };
  const { engine: instance } = engine();
  const preview = await manualPreview(instance, api, ["a", "b", "c", "d"]);
  const report = await instance.execute(api, preview.token);
  assert.deepEqual(report.results.map((entry) => entry.outcome), ["failed", "failed", "failed", "archived"]);
  assert.deepEqual(instance.lastRun, report);
});

test("automatic is off by default, requires a rule and respects selected projects", async () => {
  const { api, state } = fake([workspace("a"), workspace("b", 40, { projectId: "project-b" })]);
  const control = engine();
  assert.equal(await control.engine.runAutomatic(api), null);
  control.setSettings({ automatic: true, rule: { olderThanDays: null, keepPerProject: null }, projectIds: [] });
  assert.equal(await control.engine.runAutomatic(api), null);
  control.setSettings({ automatic: true, rule: { olderThanDays: 30, keepPerProject: null }, projectIds: ["project-b"] });
  const report = await control.engine.runAutomatic(api);
  assert.deepEqual(state.archived, ["b"]);
  assert.equal(report?.source, "automatic");
});

test("turning automatic off during a batch prevents later archives", async () => {
  const { api, state } = fake([workspace("a"), workspace("b")]);
  const settings = { automatic: true, rule: { olderThanDays: 30, keepPerProject: null }, projectIds: [] };
  const control = engine(settings);
  state.onArchive = async () => {
    control.setSettings({ ...settings, automatic: false });
    return { archivedAt: old(0), error: null };
  };
  const report = await control.engine.runAutomatic(api);
  assert.deepEqual(state.archived, ["a"]);
  assert.deepEqual(report?.results.map((entry) => entry.outcome), ["archived", "skipped"]);
});

test("global execution gate prevents manual and automatic overlap and preserves a rejected token", async () => {
  const { api, state } = fake([workspace("a"), workspace("b")]);
  const control = engine({ automatic: true, rule: { olderThanDays: 30, keepPerProject: null }, projectIds: [] });
  const first = await manualPreview(control.engine, api, ["a"]);
  const second = await manualPreview(control.engine, api, ["b"]);
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  state.onArchive = async (id) => {
    started(); await hold;
    state.workspaces = state.workspaces.filter((entry) => entry.id !== id);
    return { archivedAt: old(0), error: null };
  };
  const running = control.engine.execute(api, first.token);
  await ready;
  await assert.rejects(control.engine.execute(api, second.token), /Another archive batch is running/);
  assert.equal(await control.engine.runAutomatic(api), null);
  release();
  await running;
  await control.engine.execute(api, second.token);
  assert.deepEqual(state.archived, ["a", "b"]);
});

test("background execution returns a run ID promptly and exposes running and completed reports", async () => {
  const { api, state } = fake([workspace("a")]);
  const { engine: instance } = engine();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  state.onArchive = async () => { started(); await hold; return { archivedAt: old(0), error: null }; };
  const preview = await manualPreview(instance, api, ["a"]);
  const { runId } = instance.start(api, preview.token);
  assert.equal(instance.getRun(runId).status, "running");
  await ready;
  assert.equal((await instance.list(api)).activeRunId, runId);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(instance.getRun(runId).status, "complete");
  assert.equal(instance.getRun(runId).report?.results[0]?.outcome, "archived");
  assert.equal((await instance.list(api)).activeRunId, null);
  assert.equal(instance.getRun("missing").status, "failed");
});

test("plugin teardown stops after the in-flight archive and rejects future calls", async () => {
  const { api, state } = fake([workspace("a"), workspace("b")]);
  const { engine: instance } = engine();
  state.onArchive = async () => { instance.close(); return { archivedAt: old(0), error: null }; };
  const preview = await manualPreview(instance, api, ["a", "b"]);
  const report = await instance.execute(api, preview.token);
  assert.deepEqual(state.archived, ["a"]);
  assert.deepEqual(report.results.map((entry) => entry.outcome), ["archived", "skipped"]);
  await assert.rejects(instance.list(api), /has stopped/);
});
