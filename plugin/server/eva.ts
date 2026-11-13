import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Task } from "../shared/contracts";

const run = promisify(execFile);
const EVA_NOTIFY = "/srv/paseo-sidebar/scripts/eva_notify.py";
// Same role as eva_paseo.MARKERS: EVA does not restate it, the butler skips these sessions.
const MARKER = "【通知跟进】";
const EVENT_PREFIX = "notification_event_id=";

export async function openEvaForNotification(task: Task): Promise<string> {
  const lines = task.description.split(/\r?\n/);
  const eventId = (lines.find((l) => l.startsWith(EVENT_PREFIX)) || "").slice(EVENT_PREFIX.length).trim();
  const shown = lines.filter((l) => !l.startsWith(EVENT_PREFIX)).join("\n").trim();
  const prompt = [
    `${MARKER}这条是侧栏发的，不是我在说话：我在侧栏点了下面这条通知，想跟你处理它，不要复述。`,
    "",
    `侧栏显示：${task.name}`,
    shown,
    "",
    "先用一两句说清这是什么事、你建议的第一步（需要查的话先查完再说），然后等我回复。",
  ].join("\n");
  const child = run("/usr/bin/python3", [EVA_NOTIFY, "--open", eventId || `task:${task.id}`], { timeout: 900_000 });
  child.child.stdin?.end(prompt);
  const { stdout } = await child;
  const agentId = JSON.parse(stdout.slice(stdout.indexOf("{"))).agentId;
  if (!agentId) throw new Error(`eva_notify 没返回 agentId：${stdout.slice(0, 200)}`);
  return agentId;
}
