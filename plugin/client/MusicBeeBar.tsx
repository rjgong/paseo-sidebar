import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { localMusicBee as rpc, localMusicBeePlaylists as listsRpc } from "./musicbee-local";
import { usePanelMemory } from "./panel-memory";

const KEY = ["notion-tasks", "musicbee"];
const LISTS = ["notion-tasks", "musicbee-playlists"];
const time = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function MusicBeeBar({ theme }: { theme: PluginTheme }) {
  const c = theme.colors;
  const client = useQueryClient();
  const toast = useToast();
  const [expanded, setExpanded] = usePanelMemory("musicbee:playlists", false);
  const [search, setSearch] = usePanelMemory("musicbee:search", "");
  const [width, setWidth] = useState(1);
  const state = useQuery({ queryKey: KEY, queryFn: () => rpc({ action: "status" }), refetchInterval: 2500, retry: false });
  const data = state.data;
  const playlists = useQuery({ queryKey: LISTS, queryFn: () => listsRpc({}), enabled: expanded && data?.online === true, staleTime: 0, refetchInterval: 30000, retry: false });
  const action = useMutation({
    mutationFn: (input: Parameters<typeof rpc>[0]) => rpc(input),
    onMutate: () => client.cancelQueries({ queryKey: KEY }),
    onSuccess: value => { client.setQueryData(KEY, value); void client.invalidateQueries({ queryKey: KEY }); },
    onError: error => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const button = (label: string, text: string, input: Parameters<typeof rpc>[0], active = false, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || action.isPending, selected: active }}
      disabled={disabled || action.isPending} onPress={() => action.mutate(input)}
      style={{ minWidth: 32, minHeight: 30, alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: active ? c.surface2 : "transparent", opacity: disabled || action.isPending ? 0.4 : 1 }}>
      <Text style={{ color: c.foreground, fontSize: 15 }}>{text}</Text>
    </Pressable>
  );
  return <View style={{ flexShrink: 0, marginHorizontal: 10, marginBottom: 8, padding: 8, gap: 5, borderRadius: 7, backgroundColor: c.surface1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{data?.title || (data?.online ? "MusicBee · 选择播放列表" : "MusicBee")}</Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>{data?.online ? (data.artist || "笔记本音乐") : state.isPending ? "正在连接…" : (data?.message || (state.error instanceof Error ? state.error.message : "正在连接…"))}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="MusicBee 播放列表" onPress={() => setExpanded(!expanded)} style={{ padding: 5 }}>
        <Text style={{ color: c.foreground, fontSize: 12 }}>列表 {expanded ? "▴" : "▾"}</Text>
      </Pressable>
    </View>
    {data?.online ? <>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {button("随机播放", "⤨", { action: "shuffle" }, data.shuffle)}
        {button("上一首", "⏮", { action: "previous" }, false, !data.hasTrack)}
        {button(data.playing ? "暂停" : "播放", data.playing ? "⏸" : "▶", { action: "toggle" }, false, !data.hasTrack)}
        {button("下一首", "⏭", { action: "next" }, false, !data.hasTrack)}
        {button(["顺序播放", "列表循环", "单曲循环"][data.repeat] || "循环", data.repeat === 2 ? "↻₁" : "↻", { action: "repeat" }, data.repeat !== 0)}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{time(data.position)}</Text>
        <Pressable accessibilityRole="adjustable" accessibilityLabel="播放进度" disabled={!data.duration || action.isPending}
          accessibilityValue={{ min: 0, max: data.duration, now: data.position, text: `${time(data.position)} / ${time(data.duration)}` }}
          onLayout={event => setWidth(event.nativeEvent.layout.width)}
          onPress={event => {
            // React Native Web delivers a MouseEvent for onPress.
            const target = event.currentTarget as unknown as { getBoundingClientRect?: () => { left: number; width: number } };
            const bounds = target.getBoundingClientRect?.();
            const mouse = event.nativeEvent as unknown as { clientX?: number };
            const fraction = bounds && typeof mouse.clientX === "number"
              ? (mouse.clientX - bounds.left) / bounds.width : event.nativeEvent.locationX / width;
            if (Number.isFinite(fraction)) action.mutate({ action: "seek", position: Math.round(Math.max(0, Math.min(1, fraction)) * data.duration) });
          }}
          style={{ flex: 1, height: 16, justifyContent: "center" }}>
          <View style={{ height: 3, borderRadius: 2, backgroundColor: c.surface2 }}><View style={{ height: 3, borderRadius: 2, backgroundColor: c.foregroundMuted, width: `${Math.min(100, data.duration ? data.position / data.duration * 100 : 0)}%` }} /></View>
        </Pressable>
        <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{time(data.duration)}</Text>
      </View>
    </> : <Pressable accessibilityRole="button" disabled={action.isPending} onPress={() => action.mutate({ action: "start" })} style={{ paddingVertical: 6, alignItems: "center", borderRadius: 5, backgroundColor: c.surface2 }}>
      <Text style={{ color: c.foreground, fontSize: 12 }}>{action.isPending ? "正在打开…" : "打开 MusicBee"}</Text>
    </Pressable>}
    {expanded ? <View style={{ borderTopWidth: 1, borderTopColor: c.surface2, paddingTop: 5 }}>
      {!data?.online ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>打开 MusicBee 后显示它的播放列表</Text> : <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>MusicBee 播放列表 · 点选播放</Text>
          <Pressable accessibilityRole="button" onPress={() => void playlists.refetch()}><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>刷新</Text></Pressable>
        </View>
        <TextInput value={search} onChangeText={setSearch} placeholder="搜索文件夹或歌单" accessibilityLabel="搜索播放列表"
          style={{ fontSize: 12, color: c.foreground, backgroundColor: c.surface2, padding: 6, borderRadius: 4, marginBottom: 4 }} />
        {playlists.isPending ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>读取中…</Text> : playlists.isError ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>读取失败，点击刷新重试</Text> : !playlists.data?.playlists.length ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>MusicBee 里还没有播放列表</Text> : null}
        <ScrollView style={{ maxHeight: 180 }}>
          {playlists.data?.playlists.filter(list => list.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(list => <Pressable key={list.id} accessibilityRole="button" accessibilityLabel={`${list.name}${list.count === undefined ? "" : `，${list.count} 首`}`} disabled={action.isPending}
            onPress={() => { action.mutate({ action: "play-playlist", playlistId: list.id }); }}
            style={{ paddingVertical: 7, paddingHorizontal: 5, borderRadius: 4, flexDirection: "row", gap: 6 }}>
            <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flex: 1 }}>{list.name}</Text>
            {list.count === undefined ? null : <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{list.count} 首</Text>}
          </Pressable>)}
        </ScrollView>
      </>}
    </View> : null}
  </View>;
}
