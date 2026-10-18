# Verification

Release preparation for version 0.1.0 was checked on 2026-10-19 (Asia/Hong_Kong) with Node.js 22.14.0 and Paseo app/daemon 0.11.4. The declared supported range remains `>=0.11.4 <0.12.0`.

## Automated checks

- `npm run typecheck`: passed.
- `npm test`: 22 passed, 0 failed.
- `npm pack --dry-run --ignore-scripts`: package contents inspected for the manifest, runtime entries, imported source, overview and declared screenshots.
- `git diff --check`: passed.
- Plugin-owned source and documentation scanned for Han characters and obsolete Chinese locale settings.
- Gitleaks source and reachable Git history scans: no secrets found.

Tests cover full-project retention under search, elapsed-day boundaries, pagination, protected workspaces, missing workspace-date fallback, frozen/expired/replayed previews, activity and membership changes, retention promotion during execution, per-item errors, batch status, concurrency, automation opt-in/disable and teardown. Entrypoint tests exercise the actual hook registration and verify that only completed turns trigger automatic cleanup; failed and canceled turns do not read cleanup settings.

## Rendered interface

The actual React Native Web component was rendered with a real QueryClient, the shared retention planner, mocked host hooks and sample conversations. Checked a 1280 px dark desktop layout and a 390 px light compact layout. Published screenshots contain only sample titles, project names and paths.

Verified English visible copy, search, manual selection, disabled protected rows, a two-item preview, fractional input rejection, an age-rule preview, and automatic cleanup off by default. Compact cleanup rules and automation settings fit without horizontal overflow. No browser page errors were observed.

The sample-data harness cannot archive real workspaces. These results verify the rendered component and interactions; they are not physical iOS/Android device testing or a complete native Paseo UI journey.

## Local Paseo runtime

The existing `conversation-manager` installation was reloaded without restarting the daemon. It reported `running` with the formal display name **Paseo Conversation Manager**. A before/after comparison verified that saved cleanup settings were preserved and automatic cleanup remained disabled. No archive batch was active.

The live list RPC and a one-item manual preview succeeded. No real workspace was archived and no settings were changed during verification. Archive side effects and automatic cleanup were exercised only through fake Paseo APIs in the test suite.

## Limits

The public SDK has no atomic conditional archive, direct undo operation or cancellation for an archive request already sent to Paseo. Eligibility checks and plugin shutdown prevent subsequent items from starting; they cannot retract an in-flight archive request.

Automatic cleanup is opt-in after completed turns, not a clock schedule. Worktrees use Paseo's native archive flow because archiving may remove their backing directories. Last-run history is held in memory; preferences persist separately on each host. Versions outside the declared range and physical iOS/Android devices have not been validated.
