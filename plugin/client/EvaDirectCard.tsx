import { useEffect, useState } from "react";
import { Dimensions, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { z } from "zod";
import { directCard, directChooseRpc, directFileRpc, directReplyRpc, directStatusRpc } from "../shared/eva-direct";
import { LinkedText } from "./links";

type Decision = z.infer<typeof directCard>["decisions"][number];
const isGame = (d: Decision) => d.options.some((o) => o.action === "game_a" || o.action === "game_b");
const visibleOptions = (d: Decision) => d.options.filter((o) => o.action !== "defer" && !o.label.includes("搁置"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 10-29 用户：巡视每个会话一题，要能直接跳到那个会话。目标会话取自 send / archive_session / defer 的 target。
const sessionOf = (d: Decision) => d.options.find((o) => ["send", "archive_session", "defer"].includes(o.action) && UUID.test(o.target))?.target;

// 时间线卡片拿不到宿主的 navigation.openAgent。桌面和网页走 App 自己的路由（history + popstate，
// expo-router 会接住）；手机走 paseo:// 深链，由 App 的 /h/[serverId]/agent/[agentId] 路由打开。
function openSession(serverId: string, agentId: string): void {
  const route = `/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
  if (Platform.OS === "web") {
    const w = (globalThis as any).window;
    w.history.pushState(null, "", route);
    w.dispatchEvent(new w.PopStateEvent("popstate", { state: null }));
    return;
  }
  void Linking.openURL(`paseo:/${route}`);
}

export function EvaDirectCard({ item, theme, host }: PluginTimelineItemProps<z.infer<typeof directCard>>) {
  const card = item.data;
  const choose = useRpc(directChooseRpc), status = useRpc(directStatusRpc), reply = useRpc(directReplyRpc), fetchFile = useRpc(directFileRpc);
  const [choices, setChoices] = useState<Record<string, { label: string; agentId?: string }>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // 键 "" 是卡片底部的总回复框，其余是各题自己的输入框。
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [screen, setScreen] = useState(() => Dimensions.get("screen"));
  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ screen }) => setScreen(screen));
    return () => subscription.remove();
  }, []);
  // Screen dimensions keep the portrait layout stable when the keyboard reduces the window height.
  // 11-11 用户：笔记本上卡片也按手机横屏的紧凑尺寸。
  const compact = Platform.OS === "web" || (screen.width > screen.height && screen.height < 600);
  const c = theme.colors;
  useEffect(() => {
    let live = true;
    const refresh = () => status({ eventId: card.eventId, viewed: true })
      .then((r) => { if (live) setChoices(r.choices); }).catch((e) => { if (live) setError(String(e)); });
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { live = false; clearInterval(timer); };
  }, [card.eventId, status]);
  async function select(key: string, option: string) {
    setBusy(key); setError("");
    try {
      const result = await choose({ eventId: card.eventId, key, option });
      setChoices((old) => ({ ...old, [key]: result }));
    } catch (e) { setError(String(e)); }
    finally { setBusy(""); }
  }
  async function send(key: string) {
    setBusy(`reply:${key}`); setError("");
    try {
      await reply({ eventId: card.eventId, key, text: texts[key] || "",
        messageId: `eva-reply-${Date.now()}-${Math.random().toString(36).slice(2)}` });
      setTexts((old) => ({ ...old, [key]: "" })); setSent((old) => ({ ...old, [key]: true }));
      if (key) setChoices((old) => ({ ...old, [key]: { label: "已回复，等 EVA 接话" } }));
    } catch (e) { setError(String(e)); }
    finally { setBusy(""); }
  }
  function optionButton(d: Decision, o: Decision["options"][number]) {
    return <Pressable key={o.key} accessibilityRole="button" accessibilityLabel={`${d.title}：${o.label}`}
      disabled={!!busy} onPress={() => void select(d.key, o.key)}
      style={{ borderColor: c.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 6 : 10, minHeight: compact ? 36 : undefined, justifyContent: "center", opacity: busy ? 0.5 : 1, backgroundColor: c.surface2, flexShrink: o.action === "archive_session" ? 0 : 1, maxWidth: "100%" }}>
      <Text style={{ color: c.foreground }}>{busy === d.key ? "处理中…" : o.label}</Text>
    </Pressable>;
  }
  function replyBox(key: string, label: string, placeholder: string, decision?: Decision) {
    const value = texts[key] || "";
    // 11-11 起笔记本也用手机的排法：选项在上，归档、回复框和发送同一行。
    const native = true;
    const options = decision ? visibleOptions(decision) : [];
    // 11-06 用户：归档和回复框固定占一行；其余选项另起一行换行排列，选项多时不再和回复框挤在同一行。
    const separateOptions = native ? options.filter((o) => o.action !== "archive_session") : [];
    const inlineOptions = native ? options.filter((o) => o.action === "archive_session") : [];
    return <View style={{ gap: compact ? 4 : 6 }}>
      {decision && separateOptions.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: compact ? 6 : 8 }}>
        {separateOptions.map((o) => optionButton(decision, o))}
      </View> : null}
      <View style={native ? { flexDirection: "row", alignItems: "center", gap: compact ? 6 : 8 } : { gap: 6 }}>
      {decision ? inlineOptions.map((o) => optionButton(decision, o)) : null}
      <TextInput accessibilityLabel={label} placeholder={native && decision ? "回复这一题…" : placeholder} placeholderTextColor={c.foregroundMuted}
        multiline value={value} onChangeText={(v) => { setTexts((old) => ({ ...old, [key]: v })); setSent((old) => ({ ...old, [key]: false })); }}
        style={{ color: c.foreground, borderColor: c.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 6 : 10, minHeight: compact ? 36 : 44, ...(native ? { flex: 1, minWidth: 0 } : {}) }} />
      <Pressable accessibilityRole="button" accessibilityLabel={`发送：${label}`} disabled={!!busy || !value.trim()} onPress={() => void send(key)}
        style={native ? { minHeight: compact ? 36 : 44, paddingHorizontal: compact ? 6 : 8, justifyContent: "center", flexShrink: 0 } : undefined}>
        <Text style={{ color: c.accent, opacity: busy || !value.trim() ? 0.5 : 1 }}>{busy === `reply:${key}` ? "发送中…" : "发送"}</Text>
      </Pressable>
      </View>
      {sent[key] ? <Text style={{ color: c.foregroundMuted }}>已发送，EVA 会在这个会话里接着回复。</Text> : null}
    </View>;
  }
  return <View style={{ paddingHorizontal: compact ? 8 : 16, paddingVertical: compact ? 6 : 16, gap: compact ? 4 : 12, backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderRadius: 12 }}>
    <Text selectable style={{ color: c.foreground, fontSize: 18, fontWeight: "600" }}>{card.title}</Text>
    <LinkedText text={card.body} style={{ color: c.foreground, fontSize: 15, lineHeight: 23 }} linkColor={c.accent}
      fetchFile={(path) => fetchFile({ path })} onError={setError} />
    {/* 游戏按钮紧跟正文，排在各题前面。 */}
    {[...card.decisions].sort((a, b) => Number(!isGame(a)) - Number(!isGame(b))).map((d) => {
      // 游戏 A/B 不算一题（10-15 用户要求）：正文已写了 A/B，这里只留按钮，不另起标题、背景和输入框。
      const game = isGame(d);
      const options = game ? visibleOptions(d) : [];
      return <View key={d.key} style={game ? { gap: compact ? 4 : 8 } : { gap: compact ? 4 : 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: compact ? 4 : 12 }}>
      {game ? null : <View style={compact ? { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 2 } : { gap: 8 }}>
      <Text selectable style={{ color: c.foreground, fontWeight: "600", ...(compact ? { flexShrink: 1 } : {}) }}>{d.title}</Text>
      {!game && sessionOf(d) ? <Text accessibilityRole="link" accessibilityLabel={`打开会话：${d.title}`}
        onPress={() => { try { openSession(host.id, sessionOf(d)!); } catch (e) { setError(`打不开会话：${String(e)}`); } }}
        style={{ color: c.accent, textDecorationLine: "underline", flexShrink: 0 }}>打开会话</Text> : null}
      </View>}
      {game ? null : <LinkedText text={d.context} style={{ color: c.foreground, lineHeight: 21 }} linkColor={c.accent}
        fetchFile={(path) => fetchFile({ path })} onError={setError} />}
      {options.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: compact ? 4 : 8 }}>
        {options.map((o) => optionButton(d, o))}
      </View> : null}
      {choices[d.key] ? <Text selectable style={{ color: c.statusSuccess }}>{choices[d.key].label}</Text> : null}
      {game ? null : replyBox(d.key, `回复：${d.title}`, "不选按钮，直接写这一题的想法…", d)}
    </View>;
    })}
    {card.decisions.every(isGame) ? <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: compact ? 4 : 12 }}>
      {replyBox("", "回复 EVA", "补充情况，或问 EVA…")}
    </View> : null}
    {error ? <Text selectable style={{ color: c.statusDanger }}>{error}</Text> : null}
  </View>;
}
