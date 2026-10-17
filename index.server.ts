import type { PluginServerContext } from "@getpaseo/plugin/server";
import { archiveRunStatus, executeArchive, listConversations, preferences, previewArchive } from "./shared/contracts";
import { CleanupEngine } from "./server/engine";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const engine = new CleanupEngine(async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : null;
  });
  server.handle(listConversations, (_input, { paseo }) => engine.list(paseo));
  server.handle(previewArchive, (input, { paseo }) => engine.preview(paseo, input));
  server.handle(executeArchive, ({ token }, { paseo }) => engine.start(paseo, token));
  server.handle(archiveRunStatus, ({ runId }) => engine.getRun(runId));
  const unsubscribe = server.on("agent.turn_ended", (_event, { paseo }) => {
    // The API belongs to this plugin process. Release the hook promptly; a long
    // batch must not inherit the host's short hook-request deadline.
    void engine.runAutomatic(paseo).catch((error: unknown) => {
      console.error("Conversation Manager automatic cleanup failed", error);
    });
  });
  return () => { engine.close(); unsubscribe(); };
}
