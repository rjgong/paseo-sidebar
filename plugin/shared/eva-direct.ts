import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const directOption = z.object({
  key: z.string().min(1), label: z.string().min(1),
  action: z.enum(["start", "send", "skip", "done", "close", "defer", "dismiss_wechat", "dismiss_qq", "game_a", "game_b", "archive_session"]),
  instruction: z.string(), target: z.string(),
});
export const directDecision = z.object({
  key: z.string().min(1), title: z.string().min(1), context: z.string().min(1),
  options: z.array(directOption).min(1).max(4),
});
export const directCard = z.object({
  eventId: z.string(), title: z.string(), body: z.string(),
  decisions: z.array(directDecision),
});
export const directPublishRpc = defineRpc({
  name: "tasks.eva-direct-publish", input: z.object({ job: z.string().min(1) }),
  output: z.object({ agentId: z.string(), duplicate: z.boolean() }),
});
export const directStatusRpc = defineRpc({
  name: "tasks.eva-direct-status", input: z.object({ eventId: z.string(), viewed: z.boolean().default(false) }),
  output: z.object({ choices: z.record(z.string(), z.object({ label: z.string(), agentId: z.string().optional() })) }),
});
export const directRestoreRpc = defineRpc({
  name: "tasks.eva-direct-restore", input: z.object({ eventId: z.string().min(1) }),
  output: z.object({ state: z.enum(["restored", "present", "archived", "closed", "missing"]) }),
});
export const directChooseRpc = defineRpc({
  name: "tasks.eva-direct-choose",
  input: z.object({ eventId: z.string(), key: z.string(), option: z.string() }),
  output: z.object({ label: z.string(), agentId: z.string().optional() }),
});
export const directReplyRpc = defineRpc({
  // key 为空是整张卡片的回复，填了就是针对那一题的回复。
  name: "tasks.eva-direct-reply", input: z.object({ eventId: z.string(), key: z.string().default(""), text: z.string().trim().min(1).max(20000), messageId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
export const directFileRpc = defineRpc({
  // 手机端点卡片里的工作区路径：服务器读出文件，客户端缓存后交给手机默认程序打开。
  name: "tasks.eva-direct-file", input: z.object({ path: z.string().min(1) }),
  output: z.object({ name: z.string(), base64: z.string() }),
});
