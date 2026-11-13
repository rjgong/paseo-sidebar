// Ported from cursor-tasks src/notionApi.ts (0.0.82). Behaviour must stay
// identical because the Cursor sidebar and the laptop auto-plan job share the
// same Notion database.
import { request } from "node:https";
import type { Task } from "../shared/contracts";
import { loadConfig } from "./config";

const NOTION_VERSION = "2022-06-28";
export const TAGS = ["优先", "正事", "杂活", "反思", "课外"];
export const GROUP_TAGS = ["通知", ...TAGS];
export const PLAN_TAGS = ["这个时间段要做的", "下个时间段要做的", "今天要做的"];
const PLAN_PROPERTY = "计划";
const PLAN_DATE_PROPERTY = "计划日期";
const SCHEDULE_PROPERTY = "日程时间";
const COMPLETED_AT_PROPERTY = "完成时间";
const [PLAN_CURRENT, PLAN_NEXT, PLAN_TODAY] = PLAN_TAGS;
const SEQUENCE_TASK_RE = /^(.+?)\s+P(\d+)\s*·/;
const LINK_RE = /\b(?:https?|mybooks):\/\/[^\s<>"')]+/i;

/** Node reports failed dual-stack connects as an AggregateError with an empty message. */
export function describeNetworkError(service: string, error: any): Error {
  const inner = Array.isArray(error?.errors) ? error.errors.map((e: any) => e?.code || e?.message).filter(Boolean) : [];
  const detail = [error?.code, error?.message, ...inner].filter(Boolean).join(" / ");
  const wrapped: any = new Error(`${service} 网络错误：${detail || String(error)}`);
  wrapped.code = error?.code || error?.errors?.[0]?.code;
  return wrapped;
}

// These fail before any byte reaches Notion, so retrying is safe even for writes.
const PRE_CONNECT_CODES = new Set(["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"]);

export async function notionRequest(method: string, path: string, body?: object, version = NOTION_VERSION): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await notionRequestOnce(method, path, body, version);
    } catch (error: any) {
      if (attempt >= 4 || !PRE_CONNECT_CODES.has(error?.code)) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

function notionRequestOnce(method: string, path: string, body: object | undefined, version: string): Promise<any> {
  const { notionToken } = loadConfig();
  const data = body ? Buffer.from(JSON.stringify(body), "utf8") : undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${notionToken}`,
    "Notion-Version": version,
    "Content-Type": "application/json",
  };
  if (data) {
    headers["Content-Length"] = String(data.length);
  }
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "api.notion.com", path, method, headers, timeout: 30_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          reject(new Error(`Notion 返回无法解析：${text.slice(0, 200)}`));
          return;
        }
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`Notion API ${res.statusCode}: ${json.message || text.slice(0, 200)}`));
        } else {
          resolve(json);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Notion 请求超时")));
    req.on("error", (error) => reject(describeNetworkError("Notion", error)));
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

/** Plans reset at 23:00 Asia/Shanghai, at the configured local day boundary. */
export function logicalPlanDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  let logical = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  if (value("hour") >= 23) {
    logical = new Date(logical.getTime() + 24 * 60 * 60 * 1000);
  }
  return logical.toISOString().slice(0, 10);
}

const plainText = (items: any[]) => (items || []).map((item: any) => item?.plain_text || "").join("");

function extractContentLink(titleItems: any[], descriptionItems: any[], combinedText: string): string {
  for (const item of [...titleItems, ...descriptionItems]) {
    const href = typeof item?.href === "string" ? item.href.trim() : "";
    if (href && /^(?:https?|mybooks):\/\//i.test(href)) {
      return href;
    }
  }
  return combinedText.trim().match(LINK_RE)?.[0] || "";
}

function stripContentLink(text: string): string {
  return text.replace(new RegExp(LINK_RE.source, "gi"), "").replace(/\s+/g, " ").trim();
}

function multiSelectNames(props: any, name: string): string[] {
  return (props?.[name]?.multi_select || []).map((p: any) => p.name).filter(Boolean);
}

export function parseTask(page: any): Task {
  const props = page.properties || {};
  const titleItems = props["任务名称"]?.title || [];
  const descriptionItems = props["任务描述"]?.rich_text || [];
  const rawName = plainText(titleItems);
  const description = plainText(descriptionItems);
  const storedPlans = multiSelectNames(props, PLAN_PROPERTY);
  const planDate = String(props[PLAN_DATE_PROPERTY]?.date?.start || "").trim().slice(0, 10);
  // Plan labels from an earlier logical day are stale and must not show.
  const plans = planDate === logicalPlanDate()
    ? storedPlans
    : storedPlans.filter((plan) => !PLAN_TAGS.includes(plan));
  return {
    id: page.id,
    name: stripContentLink(rawName),
    source: props["来源"]?.select?.name || "",
    priority: props["优先级别"]?.select?.name || "",
    status: props["状态"]?.status?.name || "",
    tag: props["标签"]?.select?.name || "",
    plans,
    planDate,
    scheduledAt: String(props[SCHEDULE_PROPERTY]?.date?.start || "").trim(),
    description,
    contentLink: extractContentLink(titleItems, descriptionItems, `${rawName}\n${description}`),
    createdTime: page.created_time || "",
  };
}

export async function fetchTasks(): Promise<Task[]> {
  const { databaseId } = loadConfig();
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionRequest("POST", `/v1/databases/${databaseId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      filter: { and: [
        { property: "状态", status: { does_not_equal: "已完成" } },
        { property: "存档", checkbox: { equals: false } },
      ] },
    });
    results.push(...(data.results || []));
    cursor = data.has_more && data.next_cursor ? String(data.next_cursor) : undefined;
  } while (cursor);
  return results.map(parseTask).filter((task) => task.name.trim());
}

export async function addTask(name: string, tag: string, scheduledAt: string): Promise<void> {
  const { databaseId } = loadConfig();
  const properties: Record<string, any> = {
    "任务名称": { title: [{ text: { content: name } }] },
    "标签": { select: { name: tag || "正事" } },
  };
  if (scheduledAt) {
    await ensurePlanProperties();
    properties[SCHEDULE_PROPERTY] = { date: { start: scheduledAt } };
  }
  await notionRequest("POST", "/v1/pages", { parent: { database_id: databaseId }, properties });
}

export async function scheduleTask(pageId: string, scheduledAt: string): Promise<void> {
  await ensurePlanProperties();
  const value = scheduledAt.trim();
  await notionRequest("PATCH", `/v1/pages/${pageId}`, {
    properties: { [SCHEDULE_PROPERTY]: { date: value ? { start: value } : null } },
  });
}

export async function renameTask(pageId: string, name: string): Promise<void> {
  await notionRequest("PATCH", `/v1/pages/${pageId}`, {
    properties: { "任务名称": { title: [{ text: { content: name } }] } },
  });
}

export async function updateTaskTag(pageId: string, tag: string): Promise<void> {
  await notionRequest("PATCH", `/v1/pages/${pageId}`, {
    properties: { "标签": { select: { name: tag } } },
  });
}

export async function updateTaskPlan(pageId: string, plan: string): Promise<void> {
  if (!PLAN_TAGS.includes(plan)) {
    throw new Error(`未知计划: ${plan}`);
  }
  await ensurePlanProperties();
  const page = await notionRequest("GET", `/v1/pages/${pageId}`);
  if (page.properties?.["来源"]?.select?.name === "notification") {
    throw new Error("通知不参与任务排程");
  }
  const preserved = multiSelectNames(page.properties, PLAN_PROPERTY).filter((name) => !PLAN_TAGS.includes(name));
  const added = plan === PLAN_CURRENT ? [PLAN_CURRENT, PLAN_TODAY]
    : plan === PLAN_NEXT ? [PLAN_NEXT, PLAN_TODAY]
    : [PLAN_TODAY];
  await notionRequest("PATCH", `/v1/pages/${pageId}`, {
    properties: {
      [PLAN_PROPERTY]: { multi_select: [...preserved, ...added].map((name) => ({ name })) },
      [PLAN_DATE_PROPERTY]: { date: { start: logicalPlanDate() } },
    },
  });
}

export async function removeTaskPlan(pageId: string, plan: string): Promise<void> {
  if (!PLAN_TAGS.includes(plan)) {
    throw new Error(`未知计划: ${plan}`);
  }
  await ensurePlanProperties();
  const page = await notionRequest("GET", `/v1/pages/${pageId}`);
  // Leaving Today removes every plan label; leaving a slot removes only that slot.
  const nextPlans = multiSelectNames(page.properties, PLAN_PROPERTY)
    .filter((name) => (plan === PLAN_TODAY ? !PLAN_TAGS.includes(name) : name !== plan));
  const nextPlanDate = nextPlans.some((name) => PLAN_TAGS.includes(name)) ? logicalPlanDate() : "";
  await notionRequest("PATCH", `/v1/pages/${pageId}`, {
    properties: {
      [PLAN_PROPERTY]: { multi_select: nextPlans.map((name) => ({ name })) },
      [PLAN_DATE_PROPERTY]: { date: nextPlanDate ? { start: nextPlanDate } : null },
    },
  });
}

export interface CompletedTask {
  title: string;
  description: string;
  tag: string;
  source: string;
  plans: string[];
  planDate: string;
  completedAt: string;
  releasedNext: string;
}

export async function fetchTask(pageId: string): Promise<Task> {
  return parseTask(await notionRequest("GET", `/v1/pages/${pageId}`));
}

export async function completeTask(pageId: string): Promise<CompletedTask> {
  const page = await notionRequest("GET", `/v1/pages/${pageId}`);
  const props = page.properties || {};
  const title = plainText(props["任务名称"]?.title).trim();
  const source = props["来源"]?.select?.name || "";
  const completedAt = new Date().toISOString();
  await notionRequest("PATCH", `/v1/pages/${pageId}`, {
    properties: {
      "状态": { status: { name: "已完成" } },
      "存档": { checkbox: true },
      [COMPLETED_AT_PROPERTY]: { date: { start: completedAt } },
    },
  });
  return {
    title,
    description: plainText(props["任务描述"]?.rich_text),
    tag: props["标签"]?.select?.name || "",
    source,
    plans: multiSelectNames(props, PLAN_PROPERTY),
    planDate: String(props[PLAN_DATE_PROPERTY]?.date?.start || "").trim().slice(0, 10),
    completedAt,
    releasedNext: await releaseNextSequenceTask(title),
  };
}

/** "系列 P03 · ..." completing unlocks "系列 P04 · ...". */
async function releaseNextSequenceTask(title: string): Promise<string> {
  const match = title.match(SEQUENCE_TASK_RE);
  if (!match) {
    return "";
  }
  const [, series, numberText] = match;
  const nextMarker = `${series} P${String(Number(numberText) + 1).padStart(numberText.length, "0")} ·`;
  const { databaseId } = loadConfig();
  const response = await notionRequest("POST", `/v1/databases/${databaseId}/query`, {
    filter: { property: "任务名称", title: { contains: nextMarker } },
    page_size: 1,
  });
  const nextPage = response.results?.[0];
  if (!nextPage) {
    return "";
  }
  await notionRequest("PATCH", `/v1/pages/${nextPage.id}`, {
    properties: { "状态": { status: { name: "未开始" } }, "存档": { checkbox: false } },
  });
  return plainText(nextPage.properties?.["任务名称"]?.title).trim();
}

export async function deleteTask(pageId: string): Promise<void> {
  await notionRequest("PATCH", `/v1/pages/${pageId}`, { archived: true });
}

let planPropertiesChecked = false;

async function ensurePlanProperties(): Promise<void> {
  if (planPropertiesChecked) {
    return;
  }
  const { databaseId } = loadConfig();
  const database = await notionRequest("GET", `/v1/databases/${databaseId}`);
  const properties = database.properties || {};
  const missing: Record<string, any> = {};
  if (properties[PLAN_PROPERTY] && properties[PLAN_PROPERTY].type !== "multi_select") {
    throw new Error(`Notion 字段「${PLAN_PROPERTY}」已存在，但不是 multi_select`);
  }
  if (!properties[PLAN_PROPERTY]) {
    missing[PLAN_PROPERTY] = { multi_select: { options: [
      { name: PLAN_CURRENT, color: "red" },
      { name: PLAN_NEXT, color: "orange" },
      { name: PLAN_TODAY, color: "blue" },
    ] } };
  }
  for (const name of [PLAN_DATE_PROPERTY, SCHEDULE_PROPERTY, COMPLETED_AT_PROPERTY]) {
    if (properties[name] && properties[name].type !== "date") {
      throw new Error(`Notion 字段「${name}」已存在，但不是 date`);
    }
    if (!properties[name]) {
      missing[name] = { date: {} };
    }
  }
  if (Object.keys(missing).length) {
    await notionRequest("PATCH", `/v1/databases/${databaseId}`, { properties: missing });
  }
  planPropertiesChecked = true;
}

/** Archive an uncompleted task while preserving its original Notion record. */
export async function archiveTask(pageId: string): Promise<string> {
  const page = await notionRequest("PATCH", `/v1/pages/${pageId}`, { properties: { "存档": { checkbox: true } } });
  return plainText(page.properties?.["任务名称"]?.title).trim();
}
