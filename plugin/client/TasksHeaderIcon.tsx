import { useEffect, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const initialized = new Set<string>();
const nativeOwners = new Map<string, string>();
const removedWorkspaces = new Set<string>();
const ownerListeners = new Set<() => void>();

// Native docks retain their first workspace across navigation. Once that
// workspace disappears, the visible header must attach the dock to a live one.
export function taskSidebarWorkspaceRemoved(workspaceId: string) {
  removedWorkspaces.add(workspaceId);
  let invalidated = false;
  for (const [key, owner] of nativeOwners) {
    if (owner !== workspaceId) continue;
    nativeOwners.delete(key);
    initialized.delete(key);
    invalidated = true;
  }
  if (invalidated) ownerListeners.forEach((listener) => listener());
}

export function taskSidebarWorkspaceAvailable(workspaceId: string) {
  removedWorkspaces.delete(workspaceId);
}

function storage(): Storage | undefined {
  try { return (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage; }
  catch { return undefined; }
}

// Mounting the workspace header means the user has actually opened it. Merely
// receiving a workspace subscription update must never navigate the client.
export function TasksHeaderIcon(props: PluginButtonIconProps & { openPanel(): void }) {
  const { host, workspaceId, layout, openPanel, size, color } = props;
  const { width, height } = useWindowDimensions();
  const [ownerRevision, setOwnerRevision] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const listener = () => setOwnerRevision((revision) => revision + 1);
    ownerListeners.add(listener);
    return () => { ownerListeners.delete(listener); };
  }, []);
  useEffect(() => {
    if (layout.compact || width < 768 || (Platform.OS !== "web" && width <= height)) return;
    // Native has one shared dock per host. Reopening it for every workspace
    // replaces the retained panel after the navigation has already completed.
    const key = Platform.OS === "web"
      ? `notion-tasks:sidebar-initialized:v1:${host.id}:${workspaceId}`
      : `notion-tasks:sidebar-initialized:v2:${host.id}`;
    const saved = Platform.OS === "web" ? storage() : undefined;
    let attempts = 0;
    const open = () => {
      if (initialized.has(key) || removedWorkspaces.has(workspaceId)) return;
      try { if (saved?.getItem(key) === "1") return; } catch { /* Use the in-memory fallback. */ }
      initialized.add(key);
      try {
        openPanel();
        if (Platform.OS !== "web") nativeOwners.set(key, workspaceId);
      } catch (error) {
        initialized.delete(key);
        if (++attempts < 3) timer = setTimeout(open, 300);
        else console.warn("Could not initialize the task sidebar", error);
        return;
      }
      try { saved?.setItem(key, "1"); } catch { /* Keep the in-memory marker. */ }
    };
    // Let the workspace finish mounting; cancel if the user switches away.
    let timer = setTimeout(open, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [host.id, workspaceId, layout.compact, openPanel, width, height, ownerRevision]);
  return <Icon name="ListChecks" size={size} color={color} />;
}
