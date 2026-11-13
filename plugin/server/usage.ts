import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// One JSON file per phone-local day, read by /srv/paseo-sidebar/scripts/tasks/eva_butler.py.
// state.json keeps the cursor (end of the last window received) so the phone
// backfills from there.
const DIR = "/srv/paseo-sidebar/assistant/butler/phone-usage";
const STATE = join(DIR, "state.json");

interface DayFile {
  date: string;
  tzOffsetMin: number;
  apps: [string, number, number][];
  screen: [number, number][];
  labels: Record<string, string>;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data)}\n`, "utf8");
  await rename(tmp, path);
}

export async function usageStatus(): Promise<{ lastEnd: number | null }> {
  const state = await readJson<{ lastEnd: number }>(STATE);
  return { lastEnd: state?.lastEnd ?? null };
}

export async function ingestUsage(input: {
  start: number;
  end: number;
  tzOffsetMin: number;
  apps: [string, number, number][];
  screen: [number, number][];
  labels: Record<string, string>;
}): Promise<void> {
  const date = new Date(input.start + input.tzOffsetMin * 60_000).toISOString().slice(0, 10);
  const path = join(DIR, `${date}.json`);
  const day = (await readJson<DayFile>(path)) ?? {
    date,
    tzOffsetMin: input.tzOffsetMin,
    apps: [],
    screen: [],
    labels: {},
  };
  // A resent window replaces whatever was stored for it.
  const outside = (t: number) => t < input.start || t >= input.end;
  day.apps = [...day.apps.filter((r) => outside(r[1])), ...input.apps].sort((a, b) => a[1] - b[1]);
  day.screen = [...day.screen.filter((r) => outside(r[0])), ...input.screen].sort((a, b) => a[0] - b[0]);
  Object.assign(day.labels, input.labels);
  await writeJson(path, day);
  const state = await readJson<{ lastEnd: number }>(STATE);
  if (!state || input.end > state.lastEnd) await writeJson(STATE, { lastEnd: input.end });
}
