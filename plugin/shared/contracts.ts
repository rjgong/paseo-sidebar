import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Notion task shape, mirroring cursor-tasks src/notionApi.ts `Task`.
export const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  priority: z.string(),
  status: z.string(),
  tag: z.string(),
  plans: z.array(z.string()),
  planDate: z.string(),
  scheduledAt: z.string(),
  description: z.string(),
  contentLink: z.string(),
  createdTime: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const tasksListRpc = defineRpc({
  name: "tasks.list",
  input: z.object({}),
  output: z.object({
    tasks: z.array(taskSchema),
    tags: z.array(z.string()),
    groupTags: z.array(z.string()),
    planTags: z.array(z.string()),
  }),
});

const ok = z.object({ ok: z.literal(true) });
const id = z.string().min(1);

export const tasksAddRpc = defineRpc({
  name: "tasks.add",
  input: z.object({ name: z.string().min(1), tag: z.string(), scheduledAt: z.string() }),
  output: ok,
});

export const tasksRenameRpc = defineRpc({
  name: "tasks.rename",
  input: z.object({ id, name: z.string().min(1) }),
  output: ok,
});

export const tasksChangeTagRpc = defineRpc({
  name: "tasks.change-tag",
  input: z.object({ id, tag: z.string().min(1) }),
  output: ok,
});

export const tasksChangePlanRpc = defineRpc({
  name: "tasks.change-plan",
  input: z.object({ id, plan: z.string().min(1) }),
  output: ok,
});

export const tasksRemovePlanRpc = defineRpc({
  name: "tasks.remove-plan",
  input: z.object({ id, plan: z.string().min(1) }),
  output: ok,
});

export const tasksScheduleRpc = defineRpc({
  name: "tasks.schedule",
  input: z.object({ id, scheduledAt: z.string() }),
  output: ok,
});

export const tasksDeleteRpc = defineRpc({
  name: "tasks.delete",
  input: z.object({ id }),
  output: ok,
});

export const completionReceiptSchema = z.object({
  taskId: z.string(),
  name: z.string(),
  description: z.string(),
  tag: z.string(),
  source: z.string(),
  completedAt: z.string(),
  releasedNext: z.string(),
});
export type CompletionReceipt = z.infer<typeof completionReceiptSchema>;

export const tasksCompleteRpc = defineRpc({
  name: "tasks.complete",
  input: z.object({ id, name: z.string() }),
  output: completionReceiptSchema,
});

/** Changes whenever a script touches the shared refresh trigger file. */
export const tasksRefreshSignalRpc = defineRpc({
  name: "tasks.refresh-signal",
  input: z.object({}),
  output: z.object({ signal: z.string() }),
});

export const tasksEvaOpenRpc = defineRpc({
  name: "tasks.eva-open",
  input: z.object({ id }),
  output: z.object({ agentId: z.string() }),
});

/** Phone usage from the forked Android app (src/usage/usage-sync.native.ts); see server/usage.ts. */
export const usageStatusRpc = defineRpc({
  name: "usage.status",
  input: z.object({}),
  output: z.object({
    lastEnd: z.number().nullable(),
    /** Cursors for phone.ingest; extraPackages extends the phone's notification whitelist. */
    feedSince: z.number().nullable(),
    smsLastId: z.number().nullable(),
    extraPackages: z.array(z.string()),
    /** All-day recording switch (butler/phone-audio/config.json); see server/audio.ts. */
    audioEnabled: z.boolean(),
    /** Direct background upload over Tailscale (phone_audio_recv.py); null when not set up. */
    audioUploadUrl: z.string().nullable(),
    audioUploadToken: z.string().nullable(),
  }),
});

export const usageIngestRpc = defineRpc({
  name: "usage.ingest",
  input: z.object({
    start: z.number(),
    end: z.number(),
    tzOffsetMin: z.number(),
    apps: z.array(z.tuple([z.string(), z.number(), z.number()])),
    screen: z.array(z.tuple([z.number(), z.number()])),
    labels: z.record(z.string(), z.string()),
  }),
  output: z.object({ ok: z.literal(true) }),
});

/** Whitelisted notifications / next-alarm changes (feed: JSON lines) and all SMS; see server/phone.ts. */
export const phoneIngestRpc = defineRpc({
  name: "phone.ingest",
  input: z.object({
    feed: z.array(z.string()),
    /** [id, address, body, dateMs, type] — type 1 received, 2 sent. */
    sms: z.array(z.tuple([z.number(), z.string(), z.string(), z.number(), z.number()])),
    seenPackages: z.record(z.string(), z.string()),
  }),
  output: z.object({ ok: z.literal(true) }),
});

/** "Share to Paseo": one base64 chunk of a file; the last chunk moves it into _Inbox. */
export const inboxUploadRpc = defineRpc({
  name: "inbox.upload",
  input: z.object({
    id: z.string().regex(/^[\w-]{1,64}$/),
    name: z.string().min(1).max(255),
    index: z.number().int().min(0),
    total: z.number().int().min(1).max(400),
    data: z.string(),
  }),
  output: z.object({ saved: z.string().nullable() }),
});

/** One base64 chunk of a finished recording (.m4a) or its sidecar (.json). */
export const audioUploadRpc = defineRpc({
  name: "audio.upload",
  input: z.object({
    name: z.string().regex(/^\d{8}-\d{6}\.(m4a|json)$/),
    index: z.number().int().min(0),
    total: z.number().int().min(1).max(400),
    data: z.string(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

