# Paseo Conversation Manager

Adds a **Manage conversations** entry to the Paseo sidebar. Search and filter conversations, select individual items, and preview a batch archive. Retention rules can select conversations that have been inactive for a specified number of days or keep the most recently active conversations in each project.

Age and recency use the last activity time. When both rules are enabled, a conversation must match both to be archived. Per-project retention counts the project's complete active conversation list. Search, project and status filters only narrow the archive candidates.

Manual selection is the default. You can separately save automatic cleanup rules and enable cleanup after a conversation turn completes. Automatic cleanup responds to completion events; it does not run on a daily schedule. It can continue while the Paseo app is closed if the daemon and plugin remain running. Settings are stored separately on each host. The automatic project scope is independent of the screen's search filters.

Running conversations, pending input, pinned items, archives already in progress, running workspace services, unknown activity times and worktrees are protected. Protected items can leave more conversations than the minimum retention count. Use Paseo's native archive flow for worktrees, because archiving can remove their backing directories.

Each conversation represents a sidebar workspace, including its agents and terminals. Eligibility is checked again before archiving. Results show archived, skipped and failed items individually. Recent run history is kept in memory and clears when the plugin reloads; preferences persist. The public SDK does not provide a direct undo operation.

Requires Paseo app and daemon 0.11.4 or a compatible 0.11.x release. Supports desktop and compact layouts. The plugin uses only the selected host's Paseo data and archive API. No third-party services, API keys or LLM calls are required.
