// Grouping and formatting rules ported from cursor-tasks media/main.js.
import type { Task } from "../shared/contracts";

export const DEFAULT_PLAN_TAGS = ["这个时间段要做的", "下个时间段要做的", "今天要做的"];

export interface TaskSection {
  key: string;
  title: string;
  /** Set for the three plan lanes; rows there offer "remove from plan". */
  plan: string;
  tasks: Task[];
}

export function planDisplayName(plan: string): string {
  if (plan === DEFAULT_PLAN_TAGS[0]) return "当前";
  if (plan === DEFAULT_PLAN_TAGS[1]) return "下个";
  if (plan === DEFAULT_PLAN_TAGS[2]) return "今天";
  return plan || "计划";
}

function isBookTask(task: Task): boolean {
  if (task.source === "notification") return false;
  return /mybooks:\/\/book\//i.test(`${task.contentLink}\n${task.name}`) || /^阅读《.+》/.test(task.name.trim());
}

function belongsToPlan(task: Task, plan: string): boolean {
  // Notifications stay in their own section even with legacy plan labels.
  if (task.source === "notification") return false;
  return task.plans.includes(plan)
    || (plan === DEFAULT_PLAN_TAGS[2]
      && (task.plans.includes(DEFAULT_PLAN_TAGS[0]) || task.plans.includes(DEFAULT_PLAN_TAGS[1])));
}

export function buildSections(tasks: Task[], planTags: string[], groupTags: string[]): TaskSection[] {
  const sections: TaskSection[] = [];
  // Book progress has its own lane even when the reading sync assigns Today.
  const bookTasks = tasks.filter(isBookTask);
  const assigned = new Set(bookTasks.map((task) => task.id));
  const stepSlots = DEFAULT_PLAN_TAGS.slice(0, 2);
  for (const plan of [...new Set([...stepSlots, ...planTags])]) {
    const inPlan = tasks.filter((task) =>
      // Research parents stay in Today/their category; the first two slots hold small steps.
      !(stepSlots.includes(plan) && ["正事", "优先"].includes(task.tag))
      && belongsToPlan(task, plan) && !assigned.has(task.id));
    inPlan.forEach((task) => assigned.add(task.id));
    sections.push({ key: `plan:${plan}`, title: planDisplayName(plan), plan, tasks: inPlan });
  }
  if (bookTasks.length) {
    sections.push({ key: "books", title: "书籍", plan: "", tasks: bookTasks });
  }
  const groups = new Map<string, Task[]>();
  for (const task of tasks.filter((t) => !assigned.has(t.id))) {
    const tag = task.source === "notification" ? "通知" : task.tag || "未分类";
    groups.set(tag, [...(groups.get(tag) || []), task]);
  }
  const ordered = [...groupTags.filter((tag) => groups.has(tag)), ...[...groups.keys()].filter((tag) => !groupTags.includes(tag))];
  for (const tag of ordered) {
    sections.push({ key: `tag:${tag}`, title: tag, plan: "", tasks: groups.get(tag) || [] });
  }
  return sections;
}

export function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseCalendarDate(value: string): Date {
  const text = value.trim();
  // A date-only Notion value represents local midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(text);
}

export function formatCalendarDate(value: string): string {
  const parsed = parseCalendarDate(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(parsed);
}

/** Editable text form of a Notion date: "2026-09-29 14:30". */
export function toEditableDateTime(value: string): string {
  const parsed = parseCalendarDate(value);
  if (!value || Number.isNaN(parsed.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/**
 * Parse what the user typed into an ISO timestamp in this device's timezone.
 * Accepts "2026-09-29 14:30", "9-29 14:30", "9/29 14:30" and "14:30" (today).
 * Returns null when the text is not a date, "" when it is empty.
 */
export function parseUserDateTime(text: string, now: Date = new Date()): string | null {
  const value = text.trim();
  if (!value) return "";
  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  let year = now.getFullYear();
  let month: number, day: number, hour = 9, minute = 0;
  if (match) {
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    if (match[4]) { hour = Number(match[4]); minute = Number(match[5]); }
  } else if ((match = value.match(/^(\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/))) {
    month = Number(match[1]); day = Number(match[2]);
    if (match[3]) { hour = Number(match[3]); minute = Number(match[4]); }
  } else if ((match = value.match(/^(\d{1,2}):(\d{2})$/))) {
    month = now.getMonth() + 1; day = now.getDate(); hour = Number(match[1]); minute = Number(match[2]);
  } else {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1 || hour > 23 || minute > 59) return null;
  return date.toISOString();
}

export function createClientEventId(): string {
  return `paseo:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

const WEEKDAYS = "日一二三四五六";
const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export interface AgendaItem {
  task: Task;
  at: Date;
  allDay: boolean;
  /** Starts within the next hour. */
  soon: boolean;
  /** Start time (or the whole day, for all-day items) has passed while unfinished. */
  overdue: boolean;
}

/** Scheduled tasks from today through the next `days` days, plus anything overdue, by time. */
export function buildAgenda(tasks: Task[], days: number, now: Date = new Date()): AgendaItem[] {
  const today = startOfDay(now);
  const end = today + days * DAY_MS;
  const items: AgendaItem[] = [];
  for (const task of tasks) {
    if (!task.scheduledAt) continue;
    const at = parseCalendarDate(task.scheduledAt);
    if (Number.isNaN(at.getTime()) || at.getTime() >= end) continue;
    const allDay = isDateOnly(task.scheduledAt);
    const delta = at.getTime() - now.getTime();
    const overdue = allDay ? at.getTime() < today : delta < 0;
    items.push({ task, at, allDay, overdue, soon: !allDay && delta >= 0 && delta <= 3_600_000 });
  }
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Short label such as "今天 15:00", "明天", "周三 15:00" or "10-15 15:00". */
export function formatScheduleTag(value: string, now: Date = new Date()): string {
  const at = parseCalendarDate(value);
  if (!value || Number.isNaN(at.getTime())) return "";
  const offset = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  const day = offset === 0 ? "今天" : offset === 1 ? "明天" : offset === -1 ? "昨天"
    : offset > 1 && offset < 7 ? `周${WEEKDAYS[at.getDay()]}` : `${at.getMonth() + 1}-${at.getDate()}`;
  return isDateOnly(value) ? day : `${day} ${formatClock(at.toISOString())}`;
}
