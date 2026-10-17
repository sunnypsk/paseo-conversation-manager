import type { CleanupRule, Conversation, Filters } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function activityTime(conversation: Conversation): number | null {
  if (!conversation.activityAt) return null;
  const value = Date.parse(conversation.activityAt);
  return Number.isFinite(value) ? value : null;
}

/** Newest first. An ID breaks timestamp ties identically on every client/host. */
export function compareActivity(left: Conversation, right: Conversation): number {
  const a = activityTime(left);
  const b = activityTime(right);
  if (a === null && b !== null) return 1;
  if (a !== null && b === null) return -1;
  if (a !== null && b !== null && a !== b) return b - a;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function filterConversations(conversations: readonly Conversation[], filters: Filters): Conversation[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return conversations.filter((conversation) =>
    (!filters.projectId || conversation.projectId === filters.projectId) &&
    (filters.status === "all" || conversation.status === filters.status) &&
    (!query || [conversation.title, conversation.projectName, conversation.directory, conversation.id]
      .some((value) => value.toLocaleLowerCase().includes(query)))
  ).sort(compareActivity);
}

/** Filters only narrow candidates. Retention always counts the complete project. */
export function planCleanup(
  allConversations: readonly Conversation[],
  filters: Filters,
  rule: CleanupRule,
  nowMs = Date.now(),
): Conversation[] {
  if (!Number.isFinite(nowMs)) return [];
  if (rule.olderThanDays === null && rule.keepPerProject === null) return [];
  if (rule.olderThanDays !== null && (!Number.isInteger(rule.olderThanDays) || rule.olderThanDays < 1)) return [];
  if (rule.keepPerProject !== null && (!Number.isInteger(rule.keepPerProject) || rule.keepPerProject < 1)) return [];
  const retained = new Set<string>();
  if (rule.keepPerProject !== null) {
    const projects = new Map<string, Conversation[]>();
    for (const conversation of allConversations) {
      const group = projects.get(conversation.projectId) ?? [];
      group.push(conversation);
      projects.set(conversation.projectId, group);
    }
    for (const group of projects.values()) {
      for (const conversation of group.filter((entry) => activityTime(entry) !== null)
        .sort(compareActivity).slice(0, rule.keepPerProject)) retained.add(conversation.id);
    }
  }
  return filterConversations(allConversations, filters).filter((conversation) => {
    const activity = activityTime(conversation);
    return !conversation.protection && activity !== null && !retained.has(conversation.id) &&
      (rule.olderThanDays === null || nowMs - activity > rule.olderThanDays * DAY_MS);
  });
}
