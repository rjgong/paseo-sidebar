import { readFileSync } from "node:fs";

const CONFIG_PATH = process.env.PASEO_TASKS_CONFIG || "/srv/paseo-sidebar/config.json";

export interface TasksConfig {
  notionToken: string;
  databaseId: string;
}

let cached: { at: number; value: TasksConfig } | null = null;

export function loadConfig(): TasksConfig {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
  const value: TasksConfig = {
    notionToken: String(raw.notion_token || ""),
    databaseId: String(raw.notion_tasks_db || ""),
  };
  if (!value.notionToken || !value.databaseId) {
    throw new Error(`${CONFIG_PATH} 缺少 notion_token 或 notion_tasks_db`);
  }
  cached = { at: Date.now(), value };
  return value;
}
