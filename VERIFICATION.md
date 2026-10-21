# Verification

Release preparation for version 0.1.1 was checked on 2026-10-19 (Asia/Hong_Kong) with Node.js 22.14.0 and Paseo app/daemon 0.11.4. The declared range is now `>=0.11.4`; compatibility has been checked on 0.11.4 and 0.12.0. The release-preparation evidence below refers to 0.11.4 unless stated otherwise.

## Paseo 0.12.0 compatibility

Checked on 2026-10-21 (Asia/Hong_Kong). The previous `<0.12.0` upper bound caused the installed plugin to report `failed` on Paseo 0.12.0. Removing that bound requires no changes to the plugin's runtime code.

- Typecheck and all 22 tests passed with the pinned 0.11.4 SDK and, in a separate source copy, the 0.12.0 SDK.
- A clean source copy without development dependencies reached `running` on an isolated Paseo 0.12.0 daemon after its manifest was allowed to accept 0.12.0. The client bundle compiled successfully.
- Settings, conversation listing, manual and rule-based previews, invalid-token rejection, and missing-run handling passed against that isolated daemon. Automatic cleanup remained off. No real user workspaces were archived.
- After changing this checkout to `>=0.11.4`, the existing local installation was reloaded on Paseo 0.12.0 and reached `running`. The client catalog advertised the new range, the client bundle compiled, and the live settings and conversation-list RPCs succeeded. Automatic cleanup remained off and no archive batch was active. No settings were changed or real user workspaces archived during verification.
- The development SDK pins remain at 0.11.4 to check the minimum supported API. Later Paseo releases are allowed by the manifest but have not been validated. Native app interaction and real archive side effects were not exercised in this compatibility check.

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

## Clean-source installation

A clean GitHub installation of 0.1.0 exposed a type-only import of `@getpaseo/client` that could resolve only when development dependencies were present. Version 0.1.1 derives the same types through the host-provided `@getpaseo/plugin/server` module. Runtime behavior and archive protections are unchanged. The corrected source was copied without `node_modules` and installed on a separate temporary Paseo 0.11.4 daemon, where it reached `running` without installing development dependencies.

## Local Paseo runtime

The existing `conversation-manager` installation was reloaded without restarting the daemon. It reported `running` with the formal display name **Paseo Conversation Manager**. A before/after comparison verified that saved cleanup settings were preserved and automatic cleanup remained disabled. No archive batch was active.

The live list RPC and a one-item manual preview succeeded. No real workspace was archived and no settings were changed during verification. Archive side effects and automatic cleanup were exercised only through fake Paseo APIs in the test suite.

## Limits

The public SDK has no atomic conditional archive, direct undo operation or cancellation for an archive request already sent to Paseo. Eligibility checks and plugin shutdown prevent subsequent items from starting; they cannot retract an in-flight archive request.

Automatic cleanup is opt-in after completed turns, not a clock schedule. Worktrees use Paseo's native archive flow because archiving may remove their backing directories. Last-run history is held in memory; preferences persist separately on each host. Paseo versions other than 0.11.4 and 0.12.0, and physical iOS/Android devices, have not been validated.
