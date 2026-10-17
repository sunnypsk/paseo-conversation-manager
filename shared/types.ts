export type ConversationStatus = "running" | "attention" | "needs_input" | "failed" | "done";

export interface Conversation {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  directory: string;
  status: ConversationStatus;
  activityAt: string | null;
  protection: string | null;
}

export interface Filters {
  query: string;
  projectId: string;
  status: "all" | ConversationStatus;
}

export interface CleanupRule {
  olderThanDays: number | null;
  keepPerProject: number | null;
}

export interface PlanItem {
  id: string;
  title: string;
  projectName: string;
  activityAt: string | null;
}

export interface ArchiveResult {
  id: string;
  title: string;
  outcome: "archived" | "skipped" | "failed";
  detail: string;
}

export interface RunReport {
  startedAt: string;
  completedAt: string;
  source: "manual" | "automatic";
  results: ArchiveResult[];
}
