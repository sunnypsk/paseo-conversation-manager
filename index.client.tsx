import type { PluginClientContext, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ConversationManager } from "./client/manager";

function ManagerEntry({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ListChecks"
      label="Manage conversations"
      active={currentScreen?.screenId === "manager"}
      onPress={() => openScreen({ screenId: "manager" })}
    />
  );
}

function ManagerScreen(props: PluginScreenProps) {
  // The host picker can reuse a screen instance; drafts and run IDs belong to one host.
  return <ConversationManager key={props.host.id} {...props} />;
}

export default function contribute(client: PluginClientContext) {
  const removeScreen = client.addScreen({ id: "manager", title: "Manage conversations", Component: ManagerScreen });
  const removeSidebar = client.addSidebarHeaderItem({ id: "manager", title: "Manage conversations", Component: ManagerEntry });
  const removeCommand = client.addCommandCenterItem({
    id: "manager", title: "Manage conversations", icon: "ListChecks", context: "global",
    keywords: ["archive", "conversation", "workspace", "cleanup", "multi-select"],
    onSelect({ openScreen }) { openScreen({ screenId: "manager" }); },
  });
  return () => { removeCommand(); removeSidebar(); removeScreen(); };
}
