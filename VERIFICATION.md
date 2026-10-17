# Verification

Validated on 2026-10-18 (Asia/Hong_Kong) with local Paseo app/daemon 0.11.4.

- `npm run typecheck`: passed.
- `npm test`: 19 passed, 0 failed. Covers full-project retention under search, elapsed-day boundaries, pagination, protected workspaces, missing workspace-date fallback, frozen/expired/replayed previews, changed activity/membership, retention promotion during execution, archive errors, execution status, concurrency, automation opt-in/disable, and teardown.
- Independent source review: the automatic hook initially awaited a batch longer than the host's 30-second hook deadline. Fixed by returning promptly and retaining execution under the plugin's own lifetime.
- Installed runtime: `conversation-manager`, enabled and `running`, loaded from this directory. No daemon restart.
- Final read-only live SDK verification at 02:07 HKT: 12 active workspaces, 10 eligible, 2 working workspaces protected; manual one-item preview succeeded; keep-one-per-project preview contained 6 items. A new workspace was created during verification, and the final counts reflect it. Actual persisted automatic setting remained `false`; no active or completed archive runs.
- Native Paseo UI: Sidebar entry and contributed screen observed. This revealed the real host's missing workspace activity dates; agent-date fallback was added and verified against the live API.
- Rendered component verification: actual React Native Web component, real QueryClient and planner, with the earlier 11-workspace read-only snapshot and mocked host hooks. Checked dark desktop and 390 px light compact layouts, search, multi-select preview, preview invalidation, keep-five over a complete project despite a narrowed search, fractional input rejection, and no horizontal overflow. Archive execution was disabled in the preview harness. This is not physical iOS/Android proof.

No real workspace was archived during verification. Real archive side effects and automatic cleanup were tested with fake Paseo APIs. The public SDK has no atomic conditional archive or cancellation for an already-sent archive request; eligibility checks and plugin shutdown stop subsequent items.

Automatic cleanup is opt-in after turn completion, not a clock schedule. Worktrees use Paseo's native archive flow because archive may remove backing directories. Last-run history is in memory; preferences persist per host.

## English interface update

All plugin-owned copy is now English: the **Manage conversations** sidebar entry, screen and Command Center action; settings; help, status and accessibility text; validation and execution messages; manifest and package descriptions; README and overview. Date formatting uses `en-GB`. User-provided conversation titles, project names and paths remain unchanged.

Typecheck and all 19 existing tests passed. Source and documentation scans found no remaining Han characters or obsolete locale references outside dependencies and verification artifacts. The installed plugin reloaded successfully with its English description. A read-only comparison confirmed that saved cleanup settings were preserved, with automatic cleanup still disabled.

The actual React Native Web component was checked in dark desktop and 390 px light compact layouts with the refreshed 12-workspace snapshot. English rules and automation settings fit without horizontal overflow. Project headings now wrap when their names and English counts need more space. The preview harness had archive execution disabled; no real conversations were archived.
