import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { dailyWorkloadRpc, DIRECTIONS, type DailyWorkload } from "../shared/daily-workload";
const ROOT = "/srv/paseo-sidebar/assistant/butler/patrol";
const CATS = ["正事", "杂活", "课外", "娱乐", "离开"];
const local = (n: number) => new Date(n + 8 * 3600000).toISOString().slice(0, 19);
// Read the same persisted classification as the hourly briefing; never rescore on a UI poll.
export async function fetchDailyWorkload(date?: string, root = ROOT, now = Date.now()): Promise<DailyWorkload> {
  date ||= local(now).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("日期格式不正确");
  const result: DailyWorkload = { date, now: local(now), updatedAt: null, warnings: [], hours: Array.from({ length: 24 }, (_, hour) => ({ hour, cells: Array(6).fill(null), assessed: false, pending: [], items: [], activities: [] })) };
  const start = Date.parse(date + "T00:00:00+08:00");
  const slots = new Map<string, Record<string, number>>(), seen = new Set<string>(), quotes = new Set<string>();
  // Patrol's logical day begins at 05:00; adjacent directories can contain this calendar day.
  const files: string[] = [];
  for (const offset of [-1, 0, 1]) {
    const day = local(start + offset * 86400000).slice(0, 10);
    let names: string[];
    try { names = await readdir(join(root, day)); } catch (error: any) { if (error.code !== "ENOENT") result.warnings.push("活动记录暂时读不到"); continue; }
    files.push(...names.filter(n => /^\d{4}-result\.json$/.test(n)).sort().map(n => join(root, day, n)));
  }
  for (const file of files) {
    let data: any;
    try { data = JSON.parse(await readFile(file, "utf8")); } catch { result.warnings.push("有一份活动记录尚未读完整"); continue; }
    // Older briefings already saved the minute timeline in their material, before it was included in JSON.
    if (!data.observation_window) {
      try {
        const digest = await readFile(file.replace("-result.json", ".md"), "utf8");
        const header = digest.match(/^# 巡视素材 (\d{2}-\d{2}) (\d{2}:\d{2}) – (\d{2}-\d{2}) (\d{2}:\d{2}) CST/);
        const section = digest.split("- 连续段：\n")[1]?.split("\n## ")[0];
        if (header && section) {
          const year = file.split("/").at(-2)!.slice(0, 4);
          const a = Date.parse(`${year}-${header[1]}T${header[2]}:00+08:00`), b = Date.parse(`${year}-${header[3]}T${header[4]}:00+08:00`);
          data.observation_window = { start: a / 1000, end: b / 1000 };
          data.attention_runs = [...section.matchAll(/^  - \d{2}:\d{2} (\d+) 分｜([^｜]+)｜(.+)$/gm)].map(m => [m[2], m[3], Number(m[1])]);
        }
      } catch { /* Missing historical materials leave the exact timeline unknown. */ }
    }
    let relevant = false;
    for (const [key, raw] of Object.entries(data.slots || {})) {
      if (!key.startsWith(date + " ") || !/^\d{4}-\d{2}-\d{2} \d{2}:[0-5]0$/.test(key)) continue;
      const at = Date.parse(key.replace(" ", "T") + ":00+08:00");
      if (at > now) continue;
      relevant = true;
      const counts = slots.get(key) || {};
      for (const cat of CATS) { const n = (raw as any)?.[cat]; if (Number.isFinite(n) && n > 0) counts[cat] = (counts[cat] || 0) + n; }
      slots.set(key, counts);
    }
    const window = data.observation_window;
    if (window && Number.isFinite(window.start) && Number.isFinite(window.end)) {
      const a = window.start * 1000, b = Math.min(window.end * 1000, now);
      if (a < start + 86400000 && b > start) {
        relevant = true;
        if (data.workload?.version === 1) {
          for (const h of result.hours) if (start + (h.hour + 1) * 3600000 > a && start + h.hour * 3600000 < b) h.assessed = true;
        }
        let t = a;
        for (const run of data.attention_runs || []) {
          const end = t + run[2] * 60000;
          const label = (data.time_split?.labels || []).find((l: any) => l.device === run[0] && l.raw === run[1]);
          for (const h of result.hours) {
            const n = Math.max(0, Math.min(end, b, start + (h.hour + 1) * 3600000) - Math.max(t, a, start + h.hour * 3600000)) / 60000;
            if (!n) continue;
            const activity = label?.activity || run[1];
            let row = h.activities.find(r => r.device === run[0] && r.activity === activity);
            if (!row) h.activities.push(row = { device: run[0], activity, minutes: 0 });
            row.minutes += n;
          }
          t = end;
        }
      }
    }
    for (const item of Array.isArray(data.workload?.items) ? data.workload.items : []) {
      const at = Date.parse(item.at);
      if (!Number.isFinite(at) || at < start || at >= start + 86400000 || at > now || !DIRECTIONS.includes(item.direction) || ![1, 2, 3, 5].includes(item.points) || !item.key || !item.evidence || !item.title) continue;
      relevant = true;
      const quote = item.evidence.trim();
      if (seen.has(item.key) || quotes.has(quote)) continue;
      seen.add(item.key); quotes.add(quote);
      result.hours[Math.floor((at - start) / 3600000)].items.push(item);
    }
    for (const pending of Array.isArray(data.workload?.pending) ? data.workload.pending : []) {
      const at = Date.parse(pending.at);
      if (at >= start && at < start + 86400000 && at <= now && pending.reason) result.hours[Math.floor((at - start) / 3600000)].pending.push(pending.reason);
    }
    if (relevant) result.updatedAt = file.split("/").slice(-2).join(" ").replace("-result.json", "");
  }
  for (const [key, counts] of slots) {
    const hour = Number(key.slice(11, 13)), cell = Number(key.slice(14, 16)) / 10;
    if (hour > 23 || !Object.values(counts).some(n => n > 0)) continue;
    result.hours[hour].cells[cell] = CATS.reduce((best, cat) => (counts[cat] || 0) > (counts[best] || 0) ? cat : best, CATS[0]);
  }
  result.warnings = [...new Set(result.warnings)];
  return result;
}
export function registerDailyWorkload(server: PluginServerContext) { server.handle(dailyWorkloadRpc, ({ date }) => fetchDailyWorkload(date)); }
