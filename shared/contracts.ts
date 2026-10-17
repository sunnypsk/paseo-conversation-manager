import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const ruleSchema = z.object({
  olderThanDays: z.number().int().min(1).max(36500).nullable().default(null),
  keepPerProject: z.number().int().min(1).max(10000).nullable().default(null),
});

export const filtersSchema = z.object({
  query: z.string().max(500).default(""),
  projectId: z.string().default(""),
  status: z.enum(["all", "running", "attention", "needs_input", "failed", "done"]).default("all"),
});

export const conversationSchema = z.object({
  id: z.string(), projectId: z.string(), projectName: z.string(), title: z.string(),
  directory: z.string(), activityAt: z.string().nullable(), protection: z.string().nullable(),
  status: z.enum(["running", "attention", "needs_input", "failed", "done"]),
});

export const reportSchema = z.object({
  startedAt: z.string(), completedAt: z.string(), source: z.enum(["manual", "automatic"]),
  results: z.array(z.object({
    id: z.string(), title: z.string(), outcome: z.enum(["archived", "skipped", "failed"]), detail: z.string(),
  })),
});

export const preferences = defineSettings({
  id: "cleanup", scope: "host", version: 1,
  schema: z.object({
    automatic: z.boolean().default(false),
    rule: ruleSchema.default({ olderThanDays: 30, keepPerProject: 5 }),
    projectIds: z.array(z.string()).default([]),
  }).refine((value) => !value.automatic || value.rule.olderThanDays !== null || value.rule.keepPerProject !== null, {
    message: "Set an age or retention count before enabling automatic cleanup.",
  }),
});

export const listConversations = defineRpc({
  name: "conversations.list", input: z.object({}),
  output: z.object({ conversations: z.array(conversationSchema), lastRun: reportSchema.nullable(), activeRunId: z.string().nullable() }),
});

export const previewArchive = defineRpc({
  name: "archive.preview",
  input: z.object({
    selectedIds: z.array(z.string()).max(10000).default([]),
    filters: filtersSchema,
    rule: ruleSchema.nullable(),
  }),
  output: z.object({
    token: z.string(), expiresAt: z.string(),
    items: z.array(z.object({ id: z.string(), title: z.string(), projectName: z.string(), activityAt: z.string().nullable() })),
    protectedCount: z.number(),
  }),
});

export const executeArchive = defineRpc({
  name: "archive.execute", input: z.object({ token: z.string() }), output: z.object({ runId: z.string() }),
});

export const archiveRunStatus = defineRpc({
  name: "archive.status", input: z.object({ runId: z.string() }),
  output: z.object({ status: z.enum(["running", "complete", "failed"]), report: reportSchema.nullable(), error: z.string().nullable() }),
});
