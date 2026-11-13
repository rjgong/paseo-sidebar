import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Dimensions, Platform } from "react-native";
import { TasksSurface } from "./client/TasksSurface";
import { EvaDirectCard } from "./client/EvaDirectCard";
import { directCard } from "./shared/eva-direct";
import { TasksHeaderIcon, taskSidebarWorkspaceAvailable, taskSidebarWorkspaceRemoved } from "./client/TasksHeaderIcon";

const PANEL_ID = "tasks-panel";

// Wide landscape phones have an inline native explorer dock; portrait keeps a full tab.
function panelLocation(): "explorer" | "workspace" {
  const { width, height } = Dimensions.get("window");
  return width < 768 || (Platform.OS !== "web" && width <= height) ? "workspace" : "explorer";
}

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [
    client.addTimelineRenderer({ kind: "eva-direct", version: 1, schema: directCard, Component: EvaDirectCard }),
    client.addSurface("tasks", TasksSurface),
    client.addSidebarItem({ id: "tasks", title: "任务", icon: "ListChecks", surface: "tasks" }),
    // Beside Files/Changes in the right-hand explorer, like the Cursor activity-bar view.
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "任务",
      icon: "ListChecks",
      context: "workspace",
      locations: ["explorer", "workspace"],
      Component: TasksSurface,
    }),
    client.addCommandCenterItem({
      id: "open-tasks-panel",
      title: "在侧栏打开任务",
      icon: "ListChecks",
      keywords: ["tasks", "notion", "任务", "侧栏"],
      context: "workspace",
      onSelect: (context) => context.openPanel(PANEL_ID, { location: panelLocation() }),
    }),
  ];

  // Plugin panels have no built-in launcher, so every workspace header gets a
  // button that opens the tasks tab in its explorer sidebar.
  const buttons = new Map<string, PluginButtonRegistration>();
  const addButton = (workspaceId: string) => {
    if (!workspaceId) return;
    taskSidebarWorkspaceAvailable(workspaceId);
    if (buttons.has(workspaceId)) return;
    const openPanel = () => client.openPanel(PANEL_ID, { workspaceId, location: panelLocation() });
    const HeaderIcon = (props: PluginButtonIconProps) => <TasksHeaderIcon {...props} openPanel={openPanel} />;
    buttons.set(workspaceId, client.addHeaderButton({
      id: "open-tasks",
      workspaceId,
      button: {
        title: "在侧栏打开任务",
        icon: HeaderIcon,
        behavior: { kind: "action", onPress: openPanel },
      },
    }));
  };
  let disposed = false;
  // workspaces.subscribe only relays updates from a subscription this plugin
  // owns, so the first page must be listed with subscribe to see new workspaces.
  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") addButton(update.workspace.id);
    else if (update.kind === "remove") {
      taskSidebarWorkspaceRemoved(update.id);
      buttons.get(update.id)?.remove();
      buttons.delete(update.id);
    }
  });
  let subscription: { release(): Promise<void> } | null = null;
  void (async () => {
    const first = await client.paseo.workspaces.list({ page: { limit: 200 }, subscribe: {} });
    if (disposed) return void first.subscription.release().catch(() => undefined);
    subscription = first.subscription;
    first.entries.forEach((workspace) => addButton(workspace.id));
    let page = first.pageInfo;
    while (!disposed && page.hasMore && page.nextCursor) {
      const next = await client.paseo.workspaces.list({ page: { limit: 200, cursor: page.nextCursor } });
      next.entries.forEach((workspace) => addButton(workspace.id));
      page = next.pageInfo;
    }
  })().catch(() => undefined);

  return () => {
    disposed = true;
    unsubscribe();
    void subscription?.release().catch(() => undefined);
    buttons.forEach((button) => button.remove());
    cleanups.forEach((cleanup) => cleanup());
  };
}
