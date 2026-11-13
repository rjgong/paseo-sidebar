import { registerDailyWorkload } from "./server/daily-workload";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerDirect } from "./server/eva-direct";
import { registerBookReading } from "./server/book-reading";
import { completeTaskWithReceipt } from "./server/complete";
import {
  tasksAddRpc,
  tasksChangePlanRpc,
  tasksChangeTagRpc,
  tasksCompleteRpc,
  tasksDeleteRpc,
  tasksListRpc,
  tasksRemovePlanRpc,
  tasksRefreshSignalRpc,
  tasksRenameRpc,
  tasksScheduleRpc,
  tasksEvaOpenRpc,
  usageIngestRpc,
  phoneIngestRpc,
  inboxUploadRpc,
  usageStatusRpc,
  audioUploadRpc,
} from "./shared/contracts";
import { audioStatus, uploadAudioChunk } from "./server/audio";
import { stat } from "node:fs/promises";
import {
  GROUP_TAGS,
  PLAN_TAGS,
  TAGS,
  addTask,
  deleteTask,
  fetchTask,
  fetchTasks,
  removeTaskPlan,
  renameTask,
  scheduleTask,
  updateTaskPlan,
  updateTaskTag,
} from "./server/notion";
import { openEvaForNotification } from "./server/eva";
import { ingestUsage, usageStatus } from "./server/usage";
import { ingestPhone, phoneStatus, uploadInboxChunk } from "./server/phone";

const OK = { ok: true as const };
// External task writers touch this file to request a list refresh.
const REFRESH_TRIGGER = "/srv/paseo-sidebar/scripts/.notion-tasks-refresh";

export default function contribute(server: PluginServerContext) {
  registerDailyWorkload(server);
  registerDirect(server);
  registerBookReading(server);
  server.handle(tasksListRpc, async () => ({
    tasks: await fetchTasks(), tags: TAGS, groupTags: GROUP_TAGS, planTags: PLAN_TAGS,
  }));
  server.handle(tasksEvaOpenRpc, async ({ id }) => {
    const task = await fetchTask(id);
    if (task.source !== "notification") throw new Error("只有通知能找 EVA");
    return { agentId: await openEvaForNotification(task) };
  });
  server.handle(tasksAddRpc, async ({ name, tag, scheduledAt }) => {
    await addTask(name.trim(), tag, scheduledAt);
    return OK;
  });
  server.handle(tasksRenameRpc, async ({ id, name }) => {
    await renameTask(id, name.trim());
    return OK;
  });
  server.handle(tasksChangeTagRpc, async ({ id, tag }) => {
    await updateTaskTag(id, tag);
    return OK;
  });
  server.handle(tasksChangePlanRpc, async ({ id, plan }) => {
    await updateTaskPlan(id, plan);
    return OK;
  });
  server.handle(tasksRemovePlanRpc, async ({ id, plan }) => {
    await removeTaskPlan(id, plan);
    return OK;
  });
  server.handle(tasksScheduleRpc, async ({ id, scheduledAt }) => {
    await scheduleTask(id, scheduledAt);
    return OK;
  });
  server.handle(tasksDeleteRpc, async ({ id }) => {
    await deleteTask(id);
    return OK;
  });
  server.handle(tasksCompleteRpc, ({ id, name }) => completeTaskWithReceipt(id, name));
  server.handle(tasksRefreshSignalRpc, async () => {
    try {
      const info = await stat(REFRESH_TRIGGER);
      return { signal: `${info.mtimeMs}:${info.size}` };
    } catch {
      return { signal: "" };
    }
  });
  server.handle(usageStatusRpc, async () => ({
    ...(await usageStatus()),
    ...(await phoneStatus()),
    ...(await audioStatus()),
  }));
  server.handle(audioUploadRpc, async (input) => {
    await uploadAudioChunk(input);
    return { ok: true as const };
  });
  server.handle(phoneIngestRpc, async (input) => {
    await ingestPhone(input);
    return { ok: true as const };
  });
  server.handle(inboxUploadRpc, (input) => uploadInboxChunk(input));
  server.handle(usageIngestRpc, async (input) => {
    await ingestUsage(input);
    return { ok: true as const };
  });
  return () => {};
}
