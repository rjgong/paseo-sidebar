import { useMemo, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { ScrollView as NativeScrollView, ScrollViewProps } from "react-native";
import { panelMemory } from "./panel-memory-store";

export function usePanelMemory<T>(key: string, initial: T) {
  const host = useQueryClient();
  const memory = useMemo(() => panelMemory(host, key, initial), [host, key]);
  return [useSyncExternalStore(memory.subscribe, memory.get, memory.get), memory.set] as const;
}

export function RememberedScrollView({ memoryKey, onScroll, onContentSizeChange, ...props }:
  ScrollViewProps & { memoryKey: string }) {
  const host = useQueryClient();
  const memory = useMemo(() => panelMemory(host, `scroll:${memoryKey}`, { x: 0, y: 0 }), [host, memoryKey]);
  const initial = useRef(memory.get());
  const ref = useRef<NativeScrollView>(null);
  const restored = useRef(false);
  return <ScrollView {...props} ref={ref} contentOffset={initial.current} scrollEventThrottle={32}
    onContentSizeChange={(width, height) => {
      if (!restored.current && height > 0) {
        ref.current?.scrollTo({ ...initial.current, animated: false });
        restored.current = true;
      }
      onContentSizeChange?.(width, height);
    }}
    onScroll={event => {
      if (restored.current) memory.set(event.nativeEvent.contentOffset);
      onScroll?.(event);
    }} />;
}
