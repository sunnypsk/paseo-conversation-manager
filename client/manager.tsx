import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle } from "react-native";
import { archiveRunStatus, executeArchive, listConversations, preferences, previewArchive } from "../shared/contracts";
import { filterConversations } from "../shared/planner";
import type { Conversation, ConversationStatus, Filters, RunReport } from "../shared/types";
import { readRule, ruleInput, type RuleInput } from "./rule-input";

type Preview = RpcOutput<typeof previewArchive>;
type PreferenceValues = {
  automatic: boolean;
  rule: { olderThanDays: number | null; keepPerProject: number | null };
  projectIds: string[];
};
const statuses: { id: Filters["status"]; label: string }[] = [
  { id: "all", label: "All statuses" }, { id: "done", label: "Completed" },
  { id: "running", label: "Running" }, { id: "attention", label: "Needs review" },
  { id: "needs_input", label: "Waiting for input" }, { id: "failed", label: "Failed" },
];
const statusLabel = (status: ConversationStatus) => statuses.find((item) => item.id === status)?.label ?? status;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString("en-GB") : "Unknown activity time";
const conversationCount = (count: number) => `${count} ${count === 1 ? "conversation" : "conversations"}`;

function Copy({ theme, children, muted, style }: {
  theme: PluginTheme; children: ReactNode; muted?: boolean; style?: TextStyle | TextStyle[];
}) {
  return <Text style={[{ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 14, lineHeight: 21 }, style]}>{children}</Text>;
}

function Button({ theme, children, onPress, disabled = false, active = false, primary = false }: {
  theme: PluginTheme; children: string; onPress(): void; disabled?: boolean; active?: boolean; primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled, selected: active }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, minHeight: 42,
        borderWidth: 1, borderColor: active || primary ? theme.colors.accent : theme.colors.border,
        backgroundColor: primary ? theme.colors.accent : active ? theme.colors.surface2 : theme.colors.surface1,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        alignItems: "center", justifyContent: "center",
      })}
    >
      <Copy theme={theme} style={{ color: primary ? theme.colors.accentForeground : theme.colors.foreground, fontWeight: "600" }}>{children}</Copy>
    </Pressable>
  );
}

function Check({ theme, checked, onPress, label, disabled = false }: {
  theme: PluginTheme; checked: boolean; onPress(): void; label: string; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: checked ? theme.colors.accent : theme.colors.border, backgroundColor: checked ? theme.colors.accent : theme.colors.surface0, alignItems: "center", justifyContent: "center" }}>
        <Copy theme={theme} style={{ color: theme.colors.accentForeground, fontWeight: "700", fontSize: 15, lineHeight: 19 }}>{checked ? "✓" : ""}</Copy>
      </View>
    </Pressable>
  );
}

function RuleFields({ theme, value, onChange, disabled = false }: {
  theme: PluginTheme; value: RuleInput; onChange(value: RuleInput): void; disabled?: boolean;
}) {
  const inputStyle = { width: 88, minHeight: 42, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, paddingHorizontal: 12, color: theme.colors.foreground, backgroundColor: theme.colors.surface0, fontSize: 15 };
  return (
    <View style={{ gap: 8 }}>
      <View style={base.row}>
        <Check theme={theme} checked={value.ageEnabled} label="Enable activity age rule" disabled={disabled} onPress={() => onChange({ ...value, ageEnabled: !value.ageEnabled })} />
        <Copy theme={theme}>Last active more than</Copy>
        <TextInput accessibilityLabel="Activity age in days" keyboardType="number-pad" value={value.days} editable={value.ageEnabled && !disabled} onChangeText={(days) => onChange({ ...value, days })} style={[inputStyle, { opacity: value.ageEnabled ? 1 : 0.45 }]} />
        <Copy theme={theme}>days ago</Copy>
      </View>
      <View style={base.row}>
        <Check theme={theme} checked={value.keepEnabled} label="Enable retention count per project" disabled={disabled} onPress={() => onChange({ ...value, keepEnabled: !value.keepEnabled })} />
        <Copy theme={theme}>Keep the latest</Copy>
        <TextInput accessibilityLabel="Conversations to keep per project" keyboardType="number-pad" value={value.keep} editable={value.keepEnabled && !disabled} onChangeText={(keep) => onChange({ ...value, keep })} style={[inputStyle, { opacity: value.keepEnabled ? 1 : 0.45 }]} />
        <Copy theme={theme}>per project</Copy>
      </View>
      <Copy theme={theme} muted>When both rules are enabled, conversations must match both. Retention ranks the whole project by activity, including protected conversations with valid timestamps, regardless of search or status filters. Conversations with unknown activity times are kept and do not use a retention slot.</Copy>
    </View>
  );
}

function RunSummary({ theme, report }: { theme: PluginTheme; report: RunReport }) {
  const [expanded, setExpanded] = useState(false);
  const count = (outcome: "archived" | "skipped" | "failed") => report.results.filter((item) => item.outcome === outcome).length;
  return (
    <View style={{ gap: 8 }}>
      <View style={base.spread}>
        <Copy theme={theme} style={base.heading}>Last run</Copy>
        <Button theme={theme} onPress={() => setExpanded(!expanded)}>{expanded ? "Hide results" : "View results"}</Button>
      </View>
      <Copy theme={theme}>{report.source === "automatic" ? "Automatic cleanup" : "Manual run"} · {formatTime(report.completedAt)}</Copy>
      <Copy theme={theme}>Archived {count("archived")} · Skipped {count("skipped")} · Failed {count("failed")}</Copy>
      {expanded && report.results.map((item) => (
        <View key={item.id} style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8, gap: 2 }}>
          <Copy theme={theme}>{item.title}</Copy>
          <Copy theme={theme} style={{ color: item.outcome === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted }}>
            {item.outcome === "archived" ? "Archived" : item.outcome === "skipped" ? "Skipped" : "Failed"} · {item.detail}
          </Copy>
        </View>
      ))}
    </View>
  );
}

export function ConversationManager({ theme, layout, navigation, host }: PluginScreenProps) {
  const list = useRpc(listConversations);
  const createPreview = useRpc(previewArchive);
  const archive = useRpc(executeArchive);
  const getRunStatus = useRpc(archiveRunStatus);
  const settings = useSettings(preferences);
  const conversations = useQuery({ queryKey: ["conversations", host.id], queryFn: () => list({}), refetchInterval: 30000 });
  const previewMutation = useMutation({ mutationFn: createPreview });
  const executeMutation = useMutation({ mutationFn: archive, retry: false });
  const [filters, setFilters] = useState<Filters>({ query: "", projectId: "", status: "all" });
  const [projectPicker, setProjectPicker] = useState(false);
  const [mode, setMode] = useState<"manual" | "rule">("manual");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualRule, setManualRule] = useState<RuleInput>({ ageEnabled: true, days: "30", keepEnabled: false, keep: "5" });
  const [previewData, setPreview] = useState<Preview | null>(null);
  const [previewForKey, setPreviewForKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoRule, setAutoRule] = useState<RuleInput>({ ageEnabled: true, days: "30", keepEnabled: true, keep: "5" });
  const [autoProjects, setAutoProjects] = useState<string[]>([]);
  const [autoDirty, setAutoDirty] = useState(false);
  const [autoRevision, setAutoRevision] = useState<string | null>(null);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [trackedRun, setTrackedRun] = useState<{ hostId: string; id: string } | null>(null);
  const [recoveringStart, setRecoveringStart] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const previousRunRef = useRef<string | null>(null);
  const handledRuns = useRef(new Set<string>());
  const startGuard = useRef(false);
  const runId = (trackedRun?.hostId === host.id ? trackedRun.id : null) ?? conversations.data?.activeRunId ?? null;
  const runStatus = useQuery({
    queryKey: ["archive-run", host.id, runId], enabled: !!runId,
    queryFn: () => getRunStatus({ runId: runId! }), retry: 1,
    refetchInterval: (query) => query.state.data?.status === "running" || query.state.error ? 1000 : false,
  });
  const recoverStart = useQuery({
    queryKey: ["archive-recovery", host.id, recoveryAttempt], enabled: recoveringStart,
    queryFn: () => list({}), retry: 1,
    refetchInterval: (query) => query.state.error ? 2000 : false,
  });
  const all = conversations.data?.conversations ?? [];
  const visible = useMemo(() => filterConversations(all, filters), [all, filters]);
  const eligible = visible.filter((item) => !item.protection);
  const selectedVisibleCount = eligible.filter((item) => selected.has(item.id)).length;
  const selectedOutsideCount = selected.size - visible.filter((item) => selected.has(item.id)).length;
  const parsedRule = readRule(manualRule);
  const parsedAutoRule = readRule(autoRule);
  const noManualRules = !manualRule.ageEnabled && !manualRule.keepEnabled;
  const noAutoRules = !autoRule.ageEnabled && !autoRule.keepEnabled;
  const busy = executeMutation.isPending || !!runId || recoveringStart;
  const autoConflict = settings.status === "ready" && autoRevision !== null && settings.revision !== autoRevision && autoDirty;
  const settingsReady = settings.status === "ready";
  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of all) map.set(item.projectId, item.projectName);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: Conversation[] }>();
    for (const item of visible) {
      const group = map.get(item.projectId) ?? { name: item.projectName, rows: [] };
      group.rows.push(item);
      map.set(item.projectId, group);
    }
    return [...map].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [visible]);
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: layout.compact ? 16 : 28, gap: 18, maxWidth: 1160, width: "100%", alignSelf: "center", paddingBottom: 40 },
    card: { padding: layout.compact ? 14 : 18, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, backgroundColor: theme.colors.surface1, gap: 12 },
    search: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.foreground, backgroundColor: theme.colors.surface0, fontSize: 15 },
    listRow: { paddingVertical: 12, paddingRight: 12, flexDirection: "row", gap: 4, alignItems: "flex-start", borderTopWidth: 1, borderTopColor: theme.colors.border },
  }), [theme, layout.compact]);

  const inputKey = JSON.stringify({ hostId: host.id, filters, mode, selected: [...selected].sort(), manualRule });
  const inputKeyRef = useRef(inputKey);
  inputKeyRef.current = inputKey;
  // A changed control hides the old preview in the same render, before effects run.
  const preview = previewForKey === inputKey ? previewData : null;
  useEffect(() => { setPreview(null); setActionError(null); }, [inputKey]);
  useEffect(() => {
    if (!conversations.data) return;
    const currentIds = new Set(conversations.data.conversations.map((item) => item.id));
    setSelected((value) => {
      const next = new Set([...value].filter((id) => currentIds.has(id)));
      return next.size === value.size ? value : next;
    });
  }, [conversations.data]);
  useEffect(() => {
    if (settings.status !== "ready" || autoDirty) return;
    setAutoEnabled(settings.values.automatic);
    setAutoRule(ruleInput(settings.values.rule));
    setAutoProjects([...settings.values.projectIds]);
    setAutoRevision(settings.revision);
  }, [settings.status === "ready" ? settings.revision : null, autoDirty]);
  useEffect(() => {
    if (!runId || !runStatus.data || runStatus.data.status === "running") return;
    const key = `${host.id}:${runId}`;
    if (handledRuns.current.has(key)) return;
    handledRuns.current.add(key);
    if (runStatus.data.report) finishReport(runStatus.data.report);
    if (runStatus.data.status === "failed") {
      setActionError(runStatus.data.error ?? "The batch has stopped. Review its results before creating a new preview.");
    }
    startGuard.current = false;
    setTrackedRun(null);
    void conversations.refetch();
  }, [runId, runStatus.data, host.id]);
  useEffect(() => {
    if (!recoveringStart || !recoverStart.data) return;
    const recovered = recoverStart.data;
    setRecoveringStart(false);
    if (recovered.activeRunId) {
      setTrackedRun({ hostId: host.id, id: recovered.activeRunId });
      setActionNote("Reconnected to the active batch. Waiting for its results.");
    } else if (recovered.lastRun && recovered.lastRun.completedAt !== previousRunRef.current) {
      finishReport(recovered.lastRun);
    } else {
      setActionNote("Start was not confirmed. The daemon currently has no active batch. Review the latest results before creating a new preview.");
      startGuard.current = false;
    }
    void conversations.refetch();
  }, [recoveringStart, recoverStart.data, host.id]);

  function changeFilters(next: Partial<Filters>) { setFilters((value) => ({ ...value, ...next })); }
  function toggleSelected(id: string) {
    setSelected((value) => { const next = new Set(value); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function changeAutoRule(value: RuleInput) { setAutoRule(value); setAutoDirty(true); setAutoMessage(null); }
  function hydratePreferences(value: PreferenceValues, revision: string) {
    setAutoEnabled(value.automatic); setAutoRule(ruleInput(value.rule)); setAutoProjects([...value.projectIds]); setAutoRevision(revision); setAutoDirty(false);
  }
  async function saveAutomatic() {
    if (settings.status !== "ready" || autoRevision === null || autoConflict) return;
    if (parsedAutoRule.error || (autoEnabled && noAutoRules)) return;
    setAutoMessage(null);
    const saved = await settings.save({ automatic: autoEnabled, rule: parsedAutoRule.rule, projectIds: autoProjects }, autoRevision);
    if (saved) { setAutoDirty(false); setAutoMessage(autoEnabled ? "Saved. These rules will run after each completed agent turn." : "Saved. Automatic cleanup is off. You can still select conversations and preview manually."); }
  }
  async function requestPreview() {
    setActionError(null); setActionNote(null); setPreview(null);
    const key = inputKey;
    try {
      const result = await previewMutation.mutateAsync({ selectedIds: [...selected], filters, rule: mode === "rule" ? parsedRule.rule : null });
      if (inputKeyRef.current === key) { setPreviewForKey(key); setPreview(result); }
    } catch (error) { if (inputKeyRef.current === key) setActionError(errorMessage(error)); }
  }
  function finishReport(result: RunReport) {
    startGuard.current = false;
    setReport(result); setPreview(null);
    const failed = result.results.filter((item) => item.outcome === "failed");
    setSelected(new Set(failed.map((item) => item.id)));
    if (failed.length) { setMode("manual"); setActionNote("Failed items remain selected. Create a new preview to retry them."); }
    else setActionNote("Run complete. See the results below.");
  }
  async function executePreview() {
    if (!preview || startGuard.current || runId) return;
    startGuard.current = true;
    setActionError(null);
    previousRunRef.current = conversations.data?.lastRun?.completedAt ?? null;
    try {
      const started = await executeMutation.mutateAsync({ token: preview.token });
      setTrackedRun({ hostId: host.id, id: started.runId }); setPreview(null);
      setActionNote("Archiving. Waiting for the daemon to report results. You can leave this screen and return later.");
    } catch (error) {
      setPreview(null); setRecoveryAttempt((value) => value + 1); setRecoveringStart(true);
      setActionNote(`Start was not confirmed. Checking the batch status with the daemon: ${errorMessage(error)}`);
    }
  }

  const latestReport = report && (!conversations.data?.lastRun || report.completedAt >= conversations.data.lastRun.completedAt) ? report : conversations.data?.lastRun;
  const previewGroups = preview?.items.reduce((acc, item) => { acc.set(item.projectName, (acc.get(item.projectName) ?? 0) + 1); return acc; }, new Map<string, number>());
  const currentProject = projects.find((item) => item.id === filters.projectId)?.name ?? (filters.projectId ? "Selected project" : "All projects");
  const autoUnknownProjects = autoProjects.filter((id) => !projects.some((item) => item.id === id));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={base.spread}>
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
          <Copy theme={theme} style={{ fontSize: layout.compact ? 24 : 30, lineHeight: 38, fontWeight: "700" }}>Manage conversations</Copy>
          <Copy theme={theme} muted>Search, select, or apply rules to preview and archive conversations in batches.</Copy>
        </View>
        <Button theme={theme} disabled={conversations.isFetching || busy} onPress={() => { setPreview(null); void conversations.refetch(); }}>{conversations.isFetching ? "Loading…" : "Refresh"}</Button>
      </View>
      <Copy theme={theme} muted>Each conversation represents a workspace in the sidebar. Archiving also affects its agents and terminals.</Copy>
      {busy && <View style={styles.card}><Copy theme={theme} style={base.heading}>{recoveringStart ? "Checking batch status…" : "Archiving…"}</Copy><Copy theme={theme} muted>{runStatus.error || recoverStart.error ? "The daemon has not replied yet. Status checks will continue. Wait for confirmation before starting another batch." : "Waiting for the daemon to report results. Manual cleanup controls are paused while a batch is running."}</Copy></View>}

      <View style={styles.card}>
        <TextInput
          accessibilityLabel="Search conversations" placeholder="Search titles, projects or paths…" placeholderTextColor={theme.colors.foregroundMuted}
          value={filters.query} maxLength={500} editable={!busy} onChangeText={(query) => changeFilters({ query })} style={styles.search}
        />
        <View style={base.spread}>
          <Button theme={theme} disabled={busy} onPress={() => setProjectPicker(!projectPicker)}>{`${currentProject} ${projectPicker ? "▴" : "▾"}`}</Button>
          <Copy theme={theme} muted>{visible.length} / {all.length} conversations · {eligible.length} selectable</Copy>
        </View>
        {projectPicker && (
          <ScrollView style={{ maxHeight: 210 }} nestedScrollEnabled>
            <View style={base.row}>
              <Button theme={theme} active={!filters.projectId} disabled={busy} onPress={() => { changeFilters({ projectId: "" }); setProjectPicker(false); }}>All projects</Button>
              {projects.map((item) => <Button key={item.id} theme={theme} active={filters.projectId === item.id} disabled={busy} onPress={() => { changeFilters({ projectId: item.id }); setProjectPicker(false); }}>{item.name}</Button>)}
            </View>
          </ScrollView>
        )}
        <View style={base.row}>
          {statuses.map((item) => <Button key={item.id} theme={theme} active={filters.status === item.id} disabled={busy} onPress={() => changeFilters({ status: item.id })}>{item.label}</Button>)}
        </View>
      </View>

      <View style={styles.card}>
        <View style={base.row}>
          <Button theme={theme} active={mode === "manual"} disabled={busy} onPress={() => setMode("manual")}>Manual selection</Button>
          <Button theme={theme} active={mode === "rule"} disabled={busy} onPress={() => setMode("rule")}>Cleanup rules</Button>
        </View>
        {mode === "manual" ? (
          <>
            <View style={base.spread}>
              <Copy theme={theme} style={base.heading}>{selected.size} selected{selectedOutsideCount > 0 ? ` (${selectedOutsideCount} outside filters)` : ""}</Copy>
              <View style={base.row}>
                <Button theme={theme} disabled={busy || !eligible.length} onPress={() => setSelected((value) => new Set([...value, ...eligible.map((item) => item.id)]))}>Select all filtered</Button>
                <Button theme={theme} disabled={busy || !selected.size} onPress={() => setSelected(new Set())}>Clear selection</Button>
              </View>
            </View>
            <Copy theme={theme} muted>The preview includes selected conversations within the current filters. Use checkboxes to select conversations; open a title to view it.</Copy>
          </>
        ) : (
          <>
            <RuleFields theme={theme} value={manualRule} onChange={setManualRule} disabled={busy} />
            <Copy theme={theme} muted>These rules apply to this preview only. They do not change your manual selection or saved automation settings.</Copy>
            {(parsedRule.error || noManualRules) && <Copy theme={theme} style={{ color: theme.colors.statusWarning }}>{parsedRule.error ?? "Enable at least one rule."}</Copy>}
          </>
        )}
        <View style={base.row}>
          <Button theme={theme} primary disabled={busy || conversations.isPending || !!conversations.error || previewMutation.isPending || (mode === "manual" ? !selectedVisibleCount : !!parsedRule.error || noManualRules)} onPress={() => void requestPreview()}>{previewMutation.isPending ? "Creating preview…" : mode === "manual" ? `Preview archive (${selectedVisibleCount})` : "Apply rules and preview"}</Button>
          <Copy theme={theme} muted>Review the preview before confirming</Copy>
        </View>
      </View>

      {actionError && <View style={styles.card}><Copy theme={theme} style={{ color: theme.colors.statusDanger }}>Action not completed: {actionError}</Copy><Copy theme={theme} muted>Refresh and create a new preview to try again.</Copy></View>}
      {actionNote && <Copy theme={theme} style={{ color: theme.colors.statusSuccess }}>{actionNote}</Copy>}
      {preview && (
        <View style={[styles.card, { borderColor: theme.colors.accent }]}>
          <Copy theme={theme} style={base.heading}>Confirm archive · {conversationCount(preview.items.length)}</Copy>
          <Copy theme={theme} muted>This preview contains a fixed list. Protection is checked again during execution; conversations with new activity may be skipped. Preview expires {formatTime(preview.expiresAt)}.</Copy>
          {preview.protectedCount > 0 && <Copy theme={theme} style={{ color: theme.colors.statusWarning }}>Protected conversations excluded: {preview.protectedCount}.</Copy>}
          {previewGroups && [...previewGroups].map(([name, count]) => <Copy key={name} theme={theme}>{name} · {conversationCount(count)}</Copy>)}
          {preview.items.length ? (
            <ScrollView style={{ maxHeight: layout.compact ? 260 : 360 }} nestedScrollEnabled>
              {preview.items.map((item) => (
                <View key={item.id} style={{ paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.colors.border, gap: 2 }}>
                  <Copy theme={theme}>{item.title}</Copy><Copy theme={theme} muted>{item.projectName} · {formatTime(item.activityAt)}</Copy>
                </View>
              ))}
            </ScrollView>
          ) : <Copy theme={theme}>No eligible conversations match these conditions.</Copy>}
          <Copy theme={theme} style={{ color: theme.colors.statusWarning }}>Archiving closes the agents and terminals in each conversation. Check this list before continuing. Undo is not available here.</Copy>
          <View style={base.row}>
            <Button theme={theme} primary disabled={busy || !preview.items.length} onPress={() => void executePreview()}>{busy ? "Archiving…" : `Confirm archive (${preview.items.length})`}</Button>
            <Button theme={theme} disabled={busy} onPress={() => setPreview(null)}>Cancel preview</Button>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <View style={base.spread}>
          <Copy theme={theme} style={base.heading}>Conversations</Copy>
          <Copy theme={theme} muted>Grouped by project</Copy>
        </View>
        {conversations.isPending && <Copy theme={theme} muted>Loading conversations…</Copy>}
        {conversations.error && <Copy theme={theme} style={{ color: theme.colors.statusDanger }}>Could not load conversations: {errorMessage(conversations.error)}</Copy>}
        {!conversations.isPending && !conversations.error && !visible.length && <Copy theme={theme} muted>{all.length ? "No conversations match these filters. Try a different search or filter." : "No unarchived conversations."}</Copy>}
        {groups.map(([id, group]) => (
          <View key={id} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", paddingVertical: 5 }}>
              <Copy theme={theme} style={base.heading}>{group.name}</Copy><Copy theme={theme} muted>{conversationCount(group.rows.length)}</Copy>
            </View>
            {group.rows.map((item) => (
              <View key={item.id} style={[styles.listRow, selected.has(item.id) && { backgroundColor: theme.colors.surface2, borderRadius: 8 }]}>
                {mode === "manual" ? <Check theme={theme} checked={selected.has(item.id)} label={`Select ${item.title}`} disabled={busy || !!item.protection} onPress={() => toggleSelected(item.id)} /> : <View style={{ width: 8 }} />}
                <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                  {navigation ? <Pressable accessibilityRole="link" accessibilityLabel={`Open ${item.title}`} disabled={busy} onPress={() => navigation.openWorkspace({ workspaceId: item.id, serverId: host.id })} style={{ paddingVertical: 5 }}><Copy theme={theme} style={{ fontSize: 16, fontWeight: "600", color: theme.colors.accent }}>{item.title}</Copy></Pressable> : <Copy theme={theme} style={{ fontSize: 16, fontWeight: "600" }}>{item.title}</Copy>}
                  <View style={base.row}><Copy theme={theme} style={{ color: item.status === "failed" ? theme.colors.statusDanger : item.status === "running" ? theme.colors.statusSuccess : theme.colors.foregroundMuted }}>{statusLabel(item.status)}</Copy><Copy theme={theme} muted>· {formatTime(item.activityAt)}</Copy></View>
                  <Copy theme={theme} muted style={{ fontSize: 12 }}>{item.directory}</Copy>
                  {item.protection && <Copy theme={theme} style={{ color: theme.colors.statusWarning, fontSize: 12 }}>Protected · {item.protection}</Copy>}
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <View style={base.spread}>
          <View style={{ flex: 1, minWidth: 180, gap: 3 }}><Copy theme={theme} style={base.heading}>Automatic cleanup settings</Copy><Copy theme={theme} muted>{settings.status === "ready" && settings.values.automatic ? "On: clean up after each completed turn" : "Off by default. Select conversations manually."}</Copy></View>
          <Button theme={theme} onPress={() => setAutoOpen(!autoOpen)}>{autoOpen ? "Hide settings" : "Configure automation"}</Button>
        </View>
        {autoOpen && (
          <>
            {settings.status === "loading" && <Copy theme={theme} muted>Loading saved settings…</Copy>}
            {(settings.status === "error" || settings.status === "invalid") && <><Copy theme={theme} style={{ color: theme.colors.statusDanger }}>Could not load settings: {settings.error}</Copy><Button theme={theme} onPress={() => void settings.reload()}>Reload settings</Button></>}
            <View style={base.row}><Check theme={theme} checked={autoEnabled} disabled={!settingsReady || settings.saving} label="Clean up after each completed turn" onPress={() => { setAutoEnabled(!autoEnabled); setAutoDirty(true); setAutoMessage(null); }} /><Copy theme={theme} style={{ fontWeight: "600" }}>Clean up after each completed turn</Copy></View>
            <Copy theme={theme} muted>Once saved and enabled, these rules clean up the selected projects after each completed agent turn. This is not a timed schedule. Opening this screen or saving settings does not archive conversations immediately.</Copy>
            <RuleFields theme={theme} value={autoRule} onChange={changeAutoRule} disabled={!settingsReady || settings.saving} />
            <Copy theme={theme} style={{ fontWeight: "600" }}>Automation scope</Copy>
            <View style={base.row}>
              <Button theme={theme} active={!autoProjects.length} disabled={!settingsReady || settings.saving} onPress={() => { setAutoProjects([]); setAutoDirty(true); setAutoMessage(null); }}>All projects (including future projects)</Button>
              {projects.map((item) => <Button key={item.id} theme={theme} active={autoProjects.includes(item.id)} disabled={!settingsReady || settings.saving} onPress={() => { setAutoProjects((value) => value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id]); setAutoDirty(true); setAutoMessage(null); }}>{`${autoProjects.includes(item.id) ? "✓ " : ""}${item.name}`}</Button>)}
            </View>
            {!!autoUnknownProjects.length && <Copy theme={theme} muted>Saved projects with no unarchived conversations remain in scope: {autoUnknownProjects.length}.</Copy>}
            {!!autoProjects.length && <Copy theme={theme} muted>Selected projects: {autoProjects.length}. Clearing all selections includes all projects.</Copy>}
            {(parsedAutoRule.error || (autoEnabled && noAutoRules)) && <Copy theme={theme} style={{ color: theme.colors.statusWarning }}>{parsedAutoRule.error ?? "Enable at least one rule before turning on automatic cleanup."}</Copy>}
            {autoConflict && <Copy theme={theme} style={{ color: theme.colors.statusWarning }}>Settings changed in another screen. Reload the saved settings before editing. This will discard your unsaved changes here.</Copy>}
            {settings.saveError && <Copy theme={theme} style={{ color: theme.colors.statusDanger }}>Could not save settings: {settings.saveError}</Copy>}
            {autoMessage && <Copy theme={theme} style={{ color: theme.colors.statusSuccess }}>{autoMessage}</Copy>}
            <View style={base.row}>
              <Button theme={theme} primary disabled={!settingsReady || settings.saving || !autoDirty || autoConflict || !!parsedAutoRule.error || (autoEnabled && noAutoRules)} onPress={() => void saveAutomatic()}>{settings.saving ? "Saving…" : "Save automation settings"}</Button>
              <Button theme={theme} disabled={!settingsReady || settings.saving} onPress={() => { if (settings.status === "ready") hydratePreferences(settings.values, settings.revision); setAutoMessage(null); void settings.reload(); }}>Reload saved settings</Button>
            </View>
            {autoDirty && <Copy theme={theme} muted>These changes have not been saved. Manual search, filters and rules do not change the automation settings.</Copy>}
          </>
        )}
      </View>
      {latestReport && <View style={styles.card}><RunSummary theme={theme} report={latestReport} /></View>}
    </ScrollView>
  );
}

const base = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  spread: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 },
  heading: { fontSize: 16, fontWeight: "700", lineHeight: 24 },
});
