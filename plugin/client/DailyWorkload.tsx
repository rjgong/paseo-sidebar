import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { dailyWorkloadRpc, DIRECTIONS, type DailyWorkload as Day, type Direction } from "../shared/daily-workload";
import { usePanelMemory } from "./panel-memory";
const NAMES = ["课题", "兴趣", "系统", "阅读", "事务"];
const ICONS = ["FlaskConical", "Gamepad2", "Wrench", "BookOpen", "Coffee"];
const COLORS = ["#4f9a6e", "#5b8fc7", "#b07a3c", "#8a6fb0", "#b0668e"];
const ACTIVITY: Record<string, string> = { "正事": "#65aa86", "杂活": "#d2aa62", "课外": "#6d9bc6", "娱乐": "#c97c7a", "离开": "#d7dce3" };
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const points = (items: Day["hours"][number]["items"], dir: Direction) => items.filter(i => i.direction === dir).reduce((a, i) => a + i.points, 0);
export function DailyWorkload({ theme }: { theme: PluginTheme }) {
  const [date, setDate] = useState(today);
  useEffect(() => { const t = setInterval(() => setDate(today()), 60000); return () => clearInterval(t); }, []);
  const read = useRpc(dailyWorkloadRpc);
  const query = useQuery({ queryKey: ["notion-tasks", "daily-workload", date], queryFn: () => read({ date }), refetchInterval: 60000, refetchOnMount: false, gcTime: Infinity });
  const data = query.data, c = theme.colors;
  const [expanded, setExpanded] = usePanelMemory("workload:expanded", false);
  const [detail, setDetail] = useState<number | "daily" | null>(null);
  const selectedHour = typeof detail === "number" ? data?.hours.find(h => h.hour === detail) : null;
  const all = data?.hours.flatMap(h => h.items) || [];
  const dailyDirections = DIRECTIONS.filter(dir => points(all, dir) > 0);
  // Empty and future hours take no room. Unknown scores are explained in the detail, not as placeholders.
  const recorded = data?.hours.filter(h => h.cells.some(Boolean) || h.activities.length > 0 || h.items.length > 0) || [];
  const visible = expanded ? recorded : recorded.slice(-4);
  // Hours read left to right, then down: 15 16 / 17 18.
  const columns = [visible.filter((_, i) => i % 2 === 0), visible.filter((_, i) => i % 2 === 1)];
  if (!recorded.length) return null;
  return <View testID="daily-workload" style={{ marginHorizontal: 6, marginVertical: 2, borderWidth: 1, borderColor: c.border, borderRadius: 5, overflow: "hidden", flexShrink: 0 }}>
    {dailyDirections.length || recorded.length > 4 ? <View testID="workload-summary-row" style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingVertical: 2, borderBottomWidth: 1, borderColor: c.border }}>
      <View testID="workload-daily-summary" accessibilityLabel="当天各方向累计工作量" style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {dailyDirections.map(dir => {
        const i = DIRECTIONS.indexOf(dir), amount = points(all, dir);
        return <Pressable key={dir} testID={`workload-daily-${dir}`} accessibilityRole="button" accessibilityLabel={`${NAMES[i]}，当天累计约${amount}点，查看全天成果`} onPress={() => setDetail("daily")}
          style={{ flexDirection: "row", alignItems: "center", gap: 3, minWidth: 0, maxWidth: "100%", flexShrink: 1 }}>
          <Text style={{ color: COLORS[i], fontSize: 10, flexShrink: 0 }}>{NAMES[i]}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1, flexShrink: 1 }}>
            {Array.from({ length: amount }, (_, k) => <View key={k} testID={`workload-daily-unit-${dir}`} style={{ width: 3, height: 7, borderRadius: 0.7, backgroundColor: COLORS[i] }} />)}
          </View>
        </Pressable>;
      })}
      </View>
      {recorded.length > 4 ? <Pressable testID="workload-expand" accessibilityRole="button" accessibilityLabel={expanded ? "收起，只看最近四个小时" : "展开当天有记录的小时"} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} hitSlop={4}
        style={{ width: 20, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 8, color: c.foregroundMuted }}>{expanded ? "▲" : "▼"}</Text>
      </Pressable> : null}
    </View> : null}
    <View style={{ flexDirection: "row" }}>
      {columns.map((hours, column) => <View key={column} style={{ flex: 1, minWidth: 0, borderLeftWidth: column ? 1 : 0, borderColor: c.border }}>
        {hours.map((hour, row) => {
          const dirs = DIRECTIONS.filter(d => points(hour.items, d) > 0);
          return <Pressable key={hour.hour} testID={`workload-hour-${hour.hour}`} accessibilityRole="button" accessibilityLabel={`${hour.hour}至${hour.hour + 1}点，查看活动与工作量依据`}
            onPress={() => setDetail(hour.hour)} style={{ height: 18, borderBottomWidth: row < hours.length - 1 ? 1 : 0, borderColor: c.border, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 4, backgroundColor: dirs.length ? COLORS[DIRECTIONS.indexOf(dirs[0])] + "09" : undefined }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 10, width: 16 }}>{String(hour.hour).padStart(2, "0")}</Text>
            <View style={{ flexDirection: "row", gap: 1, flexShrink: 0 }}>
              {Array.from({ length: 6 }, (_, j) => {
                const cat = hour.cells[j];
                return <View key={j} testID={`activity-${hour.hour}-${j}`} accessibilityLabel={`${hour.hour}:${String(j * 10).padStart(2, "0")} ${cat || "没有记录"}`}
                  style={{ width: 4, height: 8, backgroundColor: cat ? ACTIVITY[cat] : "transparent" }} />;
              })}
            </View>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
              {dirs.map(dir => {
                const i = DIRECTIONS.indexOf(dir), amount = points(hour.items, dir);
                return <View key={dir} accessibilityLabel={`${NAMES[i]}约新增${amount}点`} style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1 }}>
                  <Icon name={ICONS[i]} size={12} color={COLORS[i]} />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1, maxWidth: dirs.length > 1 ? 16 : 35 }}>
                    {Array.from({ length: Math.min(amount, 8) }, (_, k) => <View key={k} testID="workload-unit" style={{ width: 3, height: 7, borderRadius: 0.7, backgroundColor: COLORS[i] }} />)}
                    {amount > 8 ? <Text style={{ color: COLORS[i], fontSize: 8, lineHeight: 8 }}>…</Text> : null}
                  </View>
                </View>;
              })}
            </View>
          </Pressable>;
        })}
      </View>)}
    </View>
    {detail !== null ? <Modal title={selectedHour ? `${date} · ${String(selectedHour.hour).padStart(2, "0")}–${String(selectedHour.hour + 1).padStart(2, "0")}` : "当天各方向累计工作量"} open onOpenChange={open => { if (!open) setDetail(null); }}>
      <Modal.Content><ScrollView style={{ maxHeight: 440 }}><View style={{ padding: 12, gap: 10 }}>
        {selectedHour ? <>
        <Text style={{ color: c.foreground, fontWeight: "600" }}>这一小时的活动</Text>
        {selectedHour.activities.length ? selectedHour.activities.slice().sort((a, b) => b.minutes - a.minutes).map((a, i) => <Text key={i} selectable style={{ color: c.foreground }}>{a.activity} · {Math.round(a.minutes)}分钟{a.device === "—" ? "" : ` · ${a.device}`}</Text>) : <Text style={{ color: c.foregroundMuted }}>这一小时尚无逐段活动明细。</Text>}
        </> : dailyDirections.map(dir => <Text key={dir} style={{ color: COLORS[DIRECTIONS.indexOf(dir)] }}>{NAMES[DIRECTIONS.indexOf(dir)]} · 约{points(all, dir)}点</Text>)}
        <Text style={{ color: c.foreground, fontWeight: "600" }}>新增成果与估分依据</Text>
        {(selectedHour ? selectedHour.items : all).map(item => <View key={item.key} style={{ gap: 4, borderTopWidth: 1, borderColor: c.border, paddingTop: 7 }}>
          <Text selectable style={{ color: c.foreground }}>{NAMES[DIRECTIONS.indexOf(item.direction)]} · 约{item.points}点 · {item.title}</Text>
          <Text selectable style={{ color: c.foregroundMuted }}>{item.at.slice(11, 16)} · {item.evidence}</Text>
        </View>)}
        {!(selectedHour ? selectedHour.items : all).length ? <Text style={{ color: c.foregroundMuted }}>{selectedHour?.assessed ? "本轮未发现这一小时可计入的新成果。" : "这段记录尚未估工作量，不能当成零进展。"}</Text> : null}
        {selectedHour?.pending.map((reason, i) => <Text key={i} selectable style={{ color: c.foregroundMuted }}>待判：{reason}</Text>)}
        {detail === "daily" ? <Text style={{ color: c.foregroundMuted }}>累计包含当天所有已估出的成果，不受下方最近四小时或展开状态影响。接入前未估分的小时未计入。</Text> : null}
        <Text selectable style={{ color: c.foregroundMuted }}>每个时间格为10分钟，颜色与巡视相同。成果旁每个短格约为1点有效工作量，按新成果粗估，不按耗时换算，也不表示总目标完成比例。</Text>
        {query.isError ? <Text style={{ color: "#c47b5f" }}>暂时无法更新，保留上一次记录。</Text> : null}
        {data?.warnings.map(w => <Text key={w} style={{ color: "#c47b5f" }}>{w}</Text>)}
        <Pressable accessibilityRole="button" onPress={() => setDetail(null)} style={{ minHeight: 22, paddingHorizontal: 5, justifyContent: "center" }}><Text style={{ color: c.foreground }}>关闭</Text></Pressable>
      </View></ScrollView></Modal.Content>
    </Modal> : null}
  </View>;
}
