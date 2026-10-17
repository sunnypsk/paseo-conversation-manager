# Paseo Conversation Manager

A local Paseo plugin for searching, filtering and batch archiving sidebar workspaces. Open **Manage conversations** in the sidebar to select conversations or preview retention rules. See [OVERVIEW.md](OVERVIEW.md) for behavior and limitations.

Requires Paseo app and daemon versions in the range `>=0.11.4 <0.12.0`.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
paseo plugin install /absolute/path/to/paseo_multiselect_workspace_plugin
```

After source changes, run `paseo plugin reload conversation-manager`. Do not restart the daemon.

The plugin starts in manual mode. Automatic cleanup is opt-in, host-scoped, and runs after an agent turn completes, rather than on a clock schedule. Review the rule and project scope before enabling it.

You can archive selected conversations, select those inactive for more than a given number of days, or retain the latest N conversations per project. For example, keeping five preserves the five most recently active conversations in each project. Enabling both age and count rules requires both conditions to match. Search filters do not change the project's retention ranking.

Plugin labels, accessibility text, settings, validation messages and documentation are in English. Conversation titles, project names and paths are displayed as provided by Paseo.

Implementation: shared pure retention planner, a daemon-side preview/execution engine, and React Native UI. Previews freeze candidate IDs; execution consumes a short-lived token and rechecks eligibility against current host data. Rule-based retention ranks each complete project before restricting candidate scope. Worktree resources and active/pinned workspaces are excluded.

Tests use in-memory fake Paseo APIs. Live UI verification should exercise search, filters and previews without archiving real user workspaces. Automated checks do not substitute for physical iOS/Android testing.
