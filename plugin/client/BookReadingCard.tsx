import { usePanelMemory, RememberedScrollView } from "./panel-memory";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { bookReadingRpc } from "../shared/book-reading";
import type { Styles } from "./styles";

const KEY = ["notion-tasks", "book-reading"];
const BODY_TYPE = Platform.OS === "web"
  ? { fontSize: 16, lineHeight: 27 }
  : { fontSize: 14, lineHeight: 23 };
export function BookReadingCard({ styles, fillAvailableSpace = false, onExpandedChange }: {
  styles: Styles; fillAvailableSpace?: boolean; onExpandedChange?: (expanded: boolean) => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const expandedHeight = Platform.OS === "web" ? Math.min(480, Math.max(276, windowHeight * 0.5)) : 276;
  const rpc = useRpc(bookReadingRpc);
  const cache = useQueryClient();
  const [collapsed, setCollapsed] = usePanelMemory("book:collapsed", false);
  const [expanded, setExpanded] = usePanelMemory("book:expanded", false);
  const [choosing, setChoosing] = useState(false);
  const fillsPanel = fillAvailableSpace && expanded && !collapsed;
  useEffect(() => { onExpandedChange?.(fillsPanel); }, [fillsPanel, onExpandedChange]);
  const query = useQuery({ queryKey: KEY, queryFn: () => rpc({ action: "get" }), staleTime: 30_000, refetchInterval: 30_000, refetchOnMount: false, gcTime: Infinity });
  const data = query.data;
  const action = useMutation({
    mutationFn: (input: { action: "next" | "previous" | "select" | "sync"; bookId?: number }) =>
      rpc({ ...input, revision: data?.revision, expanded }),
    onSuccess: result => { cache.setQueryData(KEY, result); setChoosing(false); },
  });
  const link = (title: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || action.isPending}
      style={{ paddingVertical: 5, paddingHorizontal: 6, opacity: disabled || action.isPending ? 0.4 : 1 }}>
      <Text style={styles.modalButtonText}>{title}</Text>
    </Pressable>
  );
  return <View style={{ paddingHorizontal: 12, paddingVertical: 6, gap: 4, ...(fillsPanel ? { flex: 1, minHeight: 0 } : { flexShrink: 0 }) }}>
    <View style={[styles.modalRow, { justifyContent: "space-between", flexWrap: "nowrap" }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="展开或收起书籍正文"
        onPress={() => setCollapsed(!collapsed)} style={{ flex: 1 }}>
        <Text style={styles.groupTitle} numberOfLines={1}>{collapsed ? "▸" : "▾"} {data?.title || "读一小段"}</Text>
      </Pressable>
      {data ? link("换书", () => { action.reset(); setChoosing(true); }) : null}
    </View>
    {!collapsed ? <>
      {query.isPending ? <Text style={styles.muted}>正在翻开书…</Text> : null}
      {query.isError ? <View><Text style={styles.error}>{query.error.message}</Text>
        {link("重试", () => { void query.refetch(); })}</View> : null}
      {data ? <>
        {expanded ? (
          <View style={fillsPanel ? { flex: 1, minHeight: 0, overflow: "hidden" } : { height: expandedHeight, overflow: "hidden" }}>
            <RememberedScrollView memoryKey={`book:${data.bookId}:${data.location}`} key={`${data.bookId}:${data.location}`} nestedScrollEnabled style={{ flex: 1 }}>
              <Text selectable style={[styles.readerText, BODY_TYPE]}>
                {(data.expandedText || data.text).replace(/\n{2,}/g, "\n")}
              </Text>
            </RememberedScrollView>
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="展开正文"
            accessibilityState={{ expanded: false }} onPress={() => setExpanded(true)}>
            <Text numberOfLines={4} ellipsizeMode="tail"
              style={[styles.readerText, BODY_TYPE, { height: BODY_TYPE.lineHeight * 4, overflow: "hidden" }]}>
              {data.text.replace(/\n{2,}/g, "\n")}
            </Text>
          </Pressable>
        )}
        <View style={[styles.modalRow, { justifyContent: "space-between" }]}>
          {link("上一段", () => action.mutate({ action: "previous" }), !data.hasPrevious)}
          {link(expanded ? "收起" : "展开", () => setExpanded(!expanded))}
          {link(action.isPending ? "翻页中…" : (expanded ? data.expandedHasNext : data.hasNext) ? "下一段 →" : "已到书末", () => action.mutate({ action: "next" }), !(expanded ? data.expandedHasNext : data.hasNext))}
        </View>
      </> : null}
      {action.isError ? <Text style={styles.error}>{action.error.message}</Text> : null}
    </> : null}
    {choosing && data ? <Modal open title="侧栏阅读" onOpenChange={setChoosing}>
      <Modal.Content>
        <Text style={styles.muted}>这里记住侧栏的阅读位置，不会改动 Anx 的进度。</Text>
        {link("接着 Anx 最近同步的位置读", () => action.mutate({ action: "sync" }))}
        <Text style={styles.muted}>最近的书</Text>
        {data.books.map(book => <View key={book.id}>
          {link(`${book.id === data.bookId ? "✓ " : ""}${book.title}`, () => action.mutate({ action: "select", bookId: book.id }))}
        </View>)}
        {action.isError ? <Text style={styles.error}>{action.error.message}</Text> : null}
      </Modal.Content>
    </Modal> : null}
  </View>;
}
