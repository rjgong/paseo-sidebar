import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, stat, utimes, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { completeTaskWithReceipt } from "./complete";
import { archiveTask } from "./notion";
import { directCard, directChooseRpc, directDecision, directPublishRpc, directFileRpc, directReplyRpc, directRestoreRpc, directStatusRpc } from "../shared/eva-direct";

const EVA = "/srv/paseo-sidebar/assistant";
const WORK = "/srv/paseo-sidebar";
const ROOT = join(EVA, "notify/direct");
const isPatrol = (eventId: string) => eventId.startsWith("eva-patrol:");
const run = promisify(execFile);
const PASEO_CLI = "/usr/local/bin/paseo";
const PASEO_AGENTS = "/home/example/.paseo/agents";

// 会话所在工作区里已没有未归档的会话时返回工作区 id，否则返回空。目录型工作区归档不删文件，只有 Paseo 自建的 worktree 才删。
async function emptiedWorkspace(agentId: string): Promise<string> {
  const records: { id?: string; workspaceId?: string; archivedAt?: string | null }[] = [];
  for (const dir of await readdir(PASEO_AGENTS).catch(() => [] as string[])) {
    for (const file of await readdir(join(PASEO_AGENTS, dir)).catch(() => [] as string[])) {
      if (!file.endsWith(".json")) continue;
      try { records.push(JSON.parse(await readFile(join(PASEO_AGENTS, dir, file), "utf8"))); } catch { /* 写到一半的记录跳过 */ }
    }
  }
  const workspaceId = records.find((r) => r.id === agentId)?.workspaceId;
  if (!workspaceId || records.some((r) => r.workspaceId === workspaceId && !r.archivedAt)) return "";
  return workspaceId;
}
const REFRESH_TRIGGER = "/srv/paseo-sidebar/scripts/.notion-tasks-refresh";
const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const allowed = new Set(["EVA 开工", "EVA 管家", "EVA 巡视", "EVA 晚报", "EVA 周报", "竹新社日报", "持仓异动", "schedule", "followup"]);
// 11-10: server C-drive space warnings go out as raw cards; same test as eva_notify._c_drive_only.
function cDriveOnly(job: { source?: string; body?: string }): boolean {
  if (job.source !== "unified-server-monitor") return false;
  const items = [...String(job.body || "").matchAll(/^\s*\d+\. \[(\w+)\] (.+)$/gm)];
  return items.length > 0 && items.every(m => m[1] === "WARN" && m[2].trim() === "Windows storage / C");
}
type Card = z.infer<typeof directCard>;
type Choice = { label: string; agentId?: string; option: string; applied?: boolean };
type Record = {
  card: Card; source: string; day: string; agentId: string; job: string;
  published?: string; viewedAt?: number; replied?: boolean; occurredAt?: string;
  choices: { [key: string]: Choice }; actions: { [key: string]: Choice };
  replies: string[];
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const filename = (eventId: string) => join(ROOT, hash(eventId) + ".json");
const pending = new Map<string, Promise<unknown>>();
export async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  pending.set(key, next);
  try { return await next; } finally { if (pending.get(key) === next) pending.delete(key); }
}
async function load(eventId: string): Promise<Record> {
  return JSON.parse(await readFile(filename(eventId), "utf8"));
}
async function save(record: Record): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  const path = filename(record.card.eventId), temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(record, null, 2) + "\n");
  await rename(temporary, path);
  if (record.agentId) eventsByAgent.set(record.agentId, record.card.eventId);
}

// Plugin cards are not provider history. Rebuild their projection from the durable
// record whenever Paseo registers a session after idle-close, reload, or restart.
const eventsByAgent = new Map<string, string>();
let recoveryReady: Promise<void> | undefined;
const scheduledRecovery = new Set<string>();
type RestoreState = "restored" | "present" | "archived" | "closed" | "missing";
async function ensureCard(record: Record, paseo: PaseoApi, loadClosed = false): Promise<RestoreState> {
  const agent = paseo.agents.ref(record.agentId);
  const snapshot = await agent.refresh(); // metadata only; never refreshAgent/unarchive
  if (!snapshot?.agent) return "missing";
  if (snapshot.agent.archivedAt) return "archived";
  if (!loadClosed && (snapshot.agent.status === "closed" || snapshot.agent.status === "initializing")) return "closed";
  const id = `eva-direct-${hash(JSON.stringify(record.card))}`;
  let page = await agent.timeline.refetch({ direction: "tail", limit: 100 });
  for (;;) {
    if (page.error) throw new Error(page.error);
    if (page.entries.some(({ item }) => item.type === "plugin" && item.id === id)) return "present";
    if (!page.hasOlder || !page.startCursor) break;
    page = await agent.timeline.refetch({ direction: "before", cursor: page.startCursor, limit: 100 });
  }
  // Archive can race a history fetch; don't intentionally restore a closed card.
  const latest = await agent.refresh();
  if (!latest?.agent) return "missing";
  if (latest.agent.archivedAt) return "archived";
  if (latest.agent.status === "closed" || latest.agent.status === "initializing") return "closed";
  await agent.timeline.append({ type: "plugin", id, kind: "eva-direct", version: 1, data: record.card });
  return "restored";
}
export async function restore(eventId: string, paseo: PaseoApi): Promise<RestoreState> {
  return serial(eventId, async () => ensureCard(await load(eventId), paseo));
}
function scheduleRecovery(agentId: string, paseo: PaseoApi): void {
  const eventId = eventsByAgent.get(agentId);
  if (!eventId || scheduledRecovery.has(agentId)) return;
  scheduledRecovery.add(agentId);
  // Never wait for agent loading inside session_open: that would deadlock the loader.
  setTimeout(() => {
    scheduledRecovery.delete(agentId);
    void restore(eventId, paseo).catch(error => console.error("EVA card recovery failed", { agentId, error }));
  }, 0);
}
async function watchRecovery(paseo: PaseoApi): Promise<void> {
  if (!recoveryReady) recoveryReady = (async () => {
    for (const name of await readdir(ROOT).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const record: Record = JSON.parse(await readFile(join(ROOT, name), "utf8"));
        if (record.agentId) eventsByAgent.set(record.agentId, directCard.parse(record.card).eventId);
      } catch (error) { console.error("Invalid EVA card record", { name, error }); }
    }
    const unsubscribe = paseo.agents.subscribe(update => {
      if (update.kind === "upsert" && !update.agent.archivedAt &&
          (update.agent.status === "idle" || update.agent.status === "running")) {
        scheduleRecovery(update.agent.id, paseo);
      }
    });
    try {
      // Subscribing to metadata does not load dormant agents. The live-agent cap
      // is 12; closed and archived notifications are deliberately excluded.
      const list = await paseo.agents.list({ filter: { labels: { "eva-direct": "1", "eva-main": "1" },
        statuses: ["idle", "running"], includeArchived: false }, page: { limit: 200 }, subscribe: {} });
      for (const { agent } of list.entries) scheduleRecovery(agent.id, paseo);
    } catch (error) { unsubscribe(); throw error; }
  })().catch(error => { recoveryReady = undefined; throw error; });
  return recoveryReady;
}
// 10-28: 每小时巡视卡不叫「通知」，免得和别的通知重名
// 10-29: 晚报叫「日志 · 10-28」（统计日），开工叫「任务 · 10-29」
// 10-29: 巡视故障卡也归「简报」，标题自带是哪一轮，如「简报 · 15:50 未完成」
// 10-29: 其余按类：日程/回访/守护提醒「提醒」，连接告警「故障」，竹新社「新闻 · 10-28」，周报「周报 · 第 44 周」
const REMINDER = ["schedule:", "followup:", "eva-laptop-game:", "eva-phone-game:", "phone-wake:"];
function isoWeek(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}
function sessionTitle(card: Card): string {
  const id = card.eventId;
  const daily = /^(eva-evening|eva-kickoff|zhuxinshe-daily):\d{4}-(\d{2}-\d{2})$/.exec(id);
  if (daily) return `${{ "eva-evening": "日志", "eva-kickoff": "任务", "zhuxinshe-daily": "新闻" }[daily[1]]} · ${daily[2]}`;
  const weekly = /^eva-weekly:(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (weekly) return `周报 · 第 ${isoWeek(weekly[1])} 周`;
  const head = isPatrol(id) || id.startsWith("eva-patrol-health:") ? "简报"
    : REMINDER.some(p => id.startsWith(p)) ? "提醒" : id.startsWith("phone-connection:") ? "故障" : "通知";
  return `${head} · ${card.title.replace(/^⏰\s*/u, "")}`.slice(0, 80);
}
function context(record: Record): string {
  const hubRule = isPatrol(record.card.eventId) ? `、${EVA}/notify/PATROL-HUB.md` : "";
  return `规则：${EVA}/notify/RULES.md${hubRule}。\n` +
    `通知原文、选项及处理记录：${filename(record.card.eventId)}。\n` +
    `按用户本次回复处理，不复述通知；执行前核对 choices 避免重复。卡片展示不代表执行授权。\n`;
}
export async function publish(jobName: string, paseo: PaseoApi): Promise<{ agentId: string; duplicate: boolean }> {
  if (basename(jobName) !== jobName || !/^[\w.-]+\.json$/.test(jobName)) throw new Error("无效通知文件名");
  const job = JSON.parse(await readFile(join(EVA, "notify/jobs", jobName), "utf8"));
  if (!(allowed.has(job.source) || cDriveOnly(job)) || job.mode !== "direct") throw new Error("不是已生成的 EVA 通知");
  const card = directCard.parse({ eventId: job.event_id, title: job.title, body: job.body,
    decisions: z.array(directDecision).max(100).parse(job.decisions || []) });
  await watchRecovery(paseo);
  return serial(card.eventId, async () => {
    let record: Record;
    try { record = await load(card.eventId); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      record = { card, source: job.source, day: job.day || String(job.occurred_at || job.time).slice(0, 10),
        agentId: "", job: jobName, choices: {}, actions: {}, replies: [] };
    }
    const digest = hash(JSON.stringify(card));
    const duplicate = record.published === digest;
    record.card = card; record.job = jobName;
    record.occurredAt = job.occurred_at || job.time;
    if (!record.agentId) {
      // No prompt: create an idle reply container, without starting a model turn.
      const agent = await paseo.agents.create({ cwd: EVA,
        title: sessionTitle(card),
        config: { provider: "example/assistant", modeId: "bypassPermissions", thinkingOptionId: "medium", systemPrompt: context(record) },
        idempotencyKey: `eva-direct-${hash(card.eventId)}`, labels: { "eva-notify": "1", "eva-direct": "1", "eva-main": "1" },
      });
      record.agentId = agent.id;
      await save(record);
    }
    const agent = (await paseo.agents.ref(record.agentId).refresh())?.agent;
    if (agent?.workspaceId && agent.labels?.["eva-main"] === "1") {
      await paseo.workspaces.ref(agent.workspaceId).setTitle(sessionTitle(card));
    }
    const state = await ensureCard(record, paseo, !duplicate);
    if (!duplicate && state !== "restored" && state !== "present") throw new Error(`通知会话不可发布：${state}`);
    record.published = digest;
    await save(record);
    return { agentId: record.agentId, duplicate: duplicate && state !== "restored" };
  });
}

async function choose(eventId: string, key: string, optionKey: string, paseo: PaseoApi): Promise<Choice> {
  return serial(eventId, async () => {
    const record = await load(eventId);
    const decision = record.card.decisions.find((d) => d.key === key);
    const option = decision?.options.find((o) => o.key === optionKey);
    if (!decision || !option) throw new Error("选项已变化，请刷新后再选");
    const actionKey = hash(key + "\n" + optionKey);
    let response = record.actions[actionKey];
    if (!response) {
      response = { label: `已选择：${option.label}`, option: optionKey };
      const prompt = `${context(record)}\n用户已选「${option.label}」：${decision.title}\n背景：${decision.context}\n任务：${option.instruction}\n` +
        `先核实进度，只做选定任务；发信、发微信、付款、表单提交停在最后一步之前。\n` +
        `完成或卡住时，仅本次回报一次：paseo send --no-wait ${record.agentId} "【回报】<结果；需用户处理的事>"。最多三句，必要依据简述，长日志留在结果文件。`;
      if (option.action === "start" || option.action === "game_a") {
        const agent = await paseo.agents.create({ cwd: WORK,
          config: { provider: "example/assistant", modeId: "bypassPermissions" },
          title: decision.title, prompt,
          idempotencyKey: `eva-choice-${hash(eventId + actionKey)}`,
          labels: { "eva-choice": hash(eventId + actionKey) },
        });
        response.agentId = agent.id;
        // Retain the resulting agent even if the optional workspace rename fails.
        response.label = `已开新会话：${decision.title}`;
        record.actions[actionKey] = response;
        await save(record);
        if (agent.workspaceId) await paseo.workspaces.ref(agent.workspaceId).setTitle(decision.title).catch(() => undefined);
      } else if (option.action === "send") {
        if (!/^[a-f0-9-]{36}$/.test(option.target)) throw new Error("目标会话无效，请回复 EVA 核实");
        const agent = paseo.agents.ref(option.target);
        const current = await agent.refresh();
        if (!current) throw new Error("目标会话不存在，请回复 EVA 核实");
        const messageId = [hash(eventId + actionKey).slice(0, 8), hash(eventId + actionKey).slice(8, 12),
          hash(eventId + actionKey).slice(12, 16), hash(eventId + actionKey).slice(16, 20), hash(eventId + actionKey).slice(20, 32)].join("-");
        await agent.send(prompt, { messageId });
        response.agentId = agent.id;
        response.label = `已转达选择：${option.label}`;
      } else if (option.action === "done" && option.target) {
        // Complete the linked Notion task through the sidebar completion path.
        if (!NOTION_ID.test(option.target)) throw new Error("待办 id 无效，请回复 EVA 核实");
        const completed = await completeTaskWithReceipt(option.target, decision.title);
        await utimes(REFRESH_TRIGGER, new Date(), new Date()).catch(() => writeFile(REFRESH_TRIGGER, ""));
        response.label = `已完成并关掉待办：${completed.name}`;
        record.actions[actionKey] = response;
        await save(record);
      } else if (option.action === "close") {
        if (!NOTION_ID.test(option.target)) throw new Error("待办 id 无效，请回复 EVA 核实");
        const name = await archiveTask(option.target);
        await utimes(REFRESH_TRIGGER, new Date(), new Date()).catch(() => writeFile(REFRESH_TRIGGER, ""));
        response.label = `已关掉（未完成）：${name || decision.title}`;
        record.actions[actionKey] = response;
        await save(record);
      } else if (option.action === "archive_session") {
        // 10-29：巡视每个会话一题，「归档」直接归档该工作会话，不给它发消息。
        if (!/^[a-f0-9-]{36}$/.test(option.target)) throw new Error("目标会话无效，请回复 EVA 核实");
        await run(process.execPath, [PASEO_CLI, "archive", option.target], { timeout: 60_000 });
        // 10-29 用户：只归档会话时侧栏那一项还在、点进去是空的。侧栏列的是工作区，这里没有别的未归档会话就把工作区也归档。
        const workspaceId = await emptiedWorkspace(option.target);
        if (workspaceId) await run(process.execPath, [PASEO_CLI, "workspace", "archive", workspaceId], { timeout: 60_000 });
        response.label = `已归档会话：${decision.title}`;
        record.actions[actionKey] = response;
        await save(record);
      }
    }
    if (!response.applied) {
      // Retry bookkeeping after a successful launch without creating a second agent.
      const child = run("/usr/bin/python3", ["/srv/paseo-sidebar/scripts/eva_direct.py", "--record"], { timeout: 30_000 });
      child.child.stdin?.end(JSON.stringify({ source: record.source, day: record.day, event_id: eventId,
        key, title: decision.title, option, agent_id: response.agentId || "" }));
      await child;
      response.applied = true;
      record.actions[actionKey] = response;
    }
    record.choices[key] = response;
    const reply = option.action === "game_a" ? "A. 现在做正事" : option.action === "game_b" ? "B. 接着做现在这个" : option.label;
    record.replies.push(reply);
    record.replied = true;
    await save(record);
    return response;
  });
}

export function registerDirect(server: PluginServerContext): void {
  server.before("agent.session_open", async ({ request }, { paseo }) => {
    if (request.cwd.replace(/\/+$/, "") === EVA) {
      await watchRecovery(paseo).catch(error => console.error("EVA recovery subscription failed", error));
    }
  });
  server.handle(directRestoreRpc, async ({ eventId }, { paseo }) => {
    await watchRecovery(paseo);
    return { state: await restore(eventId, paseo) };
  });
  server.handle(directPublishRpc, ({ job }, { paseo }) => publish(job, paseo));
  server.handle(directStatusRpc, ({ eventId, viewed }) => serial(eventId, async () => {
    const record = await load(eventId);
    if (viewed && !record.viewedAt) { record.viewedAt = Date.now() / 1000; await save(record); }
    return { choices: record.choices };
  }));
  server.handle(directFileRpc, async ({ path }) => {
    // 只给工作区内的普通文件，按真实路径核对，挡掉 .. 和软链接跳出去。
    const real = await realpath(path);
    if (!real.startsWith(`${WORK}/`)) throw new Error("只能打开工作区里的文件");
    const info = await stat(real);
    if (!info.isFile()) throw new Error("这不是文件");
    if (info.size > 40 * 1024 * 1024) throw new Error("文件超过 40 MB，手机上不拉取");
    return { name: basename(real), base64: (await readFile(real)).toString("base64") };
  });
  server.handle(directChooseRpc, ({ eventId, key, option }, { paseo }) => choose(eventId, key, option, paseo));
  server.handle(directReplyRpc, ({ eventId, key, text, messageId }, { paseo }) => serial(eventId, async () => {
    const record = await load(eventId);
    const decision = key ? record.card.decisions.find((d) => d.key === key) : undefined;
    if (key && !decision) throw new Error("这一题已变化，请刷新后再回复");
    // Rules and the live card record are already referenced by the session system prompt.
    const about = decision ? `「${decision.title}」：${text}` : text;
    await paseo.agents.ref(record.agentId).send(about, { messageId });
    if (decision) record.choices[decision.key] = { label: `已回复：${text.slice(0, 60)}`, option: "reply" };
    record.replied = true; record.replies.push(decision ? `「${decision.title}」${text}` : text); await save(record);
    return { ok: true as const };
  }));
}
