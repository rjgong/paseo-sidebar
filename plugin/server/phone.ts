import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

// Phone feed from the forked Android app (src/usage/usage-sync.native.ts): whitelisted
// notifications, next-alarm changes and every SMS. One JSONL per Beijing day, read
// by /srv/paseo-sidebar/scripts/tasks/eva_butler.py. state.json keeps the cursors; lines are
// deduped by key because the phone resends the edge of each window.
const DIR = "/srv/paseo-sidebar/assistant/butler/phone-feed";
const STATE = join(DIR, "state.json");
const SEEN = join(DIR, "seen-packages.json");
// Hand-edited list of extra package names for the notification whitelist.
const EXTRA = join(DIR, "extra-packages.json");
const INBOX = "/srv/paseo-sidebar/_Inbox";
const CST_MS = 8 * 3600_000;

interface FeedState {
  feedSince: number | null;
  smsLastId: number | null;
}

interface FeedLine {
  kind: string;
  t: number;
  key: string;
  [field: string]: unknown;
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
  await writeFile(tmp, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  await rename(tmp, path);
}

export async function phoneStatus(): Promise<FeedState & { extraPackages: string[] }> {
  const state = await readJson<FeedState>(STATE);
  const extra = await readJson<string[]>(EXTRA);
  return {
    feedSince: state?.feedSince ?? null,
    smsLastId: state?.smsLastId ?? null,
    extraPackages: Array.isArray(extra) ? extra.filter((p) => typeof p === "string") : [],
  };
}

const cstDate = (t: number) => new Date(t + CST_MS).toISOString().slice(0, 10);

async function appendLines(lines: FeedLine[]): Promise<void> {
  const byDay = new Map<string, FeedLine[]>();
  for (const line of lines) {
    const day = cstDate(line.t);
    byDay.set(day, [...(byDay.get(day) ?? []), line]);
  }
  await mkdir(DIR, { recursive: true });
  for (const [day, rows] of byDay) {
    const path = join(DIR, `${day}.jsonl`);
    const existing = await readFile(path, "utf8").catch(() => "");
    const keys = new Set<string>();
    for (const raw of existing.split("\n")) {
      try {
        keys.add((JSON.parse(raw) as FeedLine).key);
      } catch {}
    }
    const fresh = rows.filter((r) => !keys.has(r.key) && keys.add(r.key));
    if (fresh.length) await appendFile(path, fresh.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
  }
}

export async function ingestPhone(input: {
  feed: string[];
  sms: [number, string, string, number, number][];
  seenPackages: Record<string, string>;
}): Promise<void> {
  const lines: FeedLine[] = [];
  for (const raw of input.feed) {
    try {
      const line = JSON.parse(raw) as FeedLine;
      if (typeof line.t === "number" && typeof line.key === "string" && typeof line.kind === "string") lines.push(line);
    } catch {}
  }
  for (const [id, addr, body, t, type] of input.sms) {
    lines.push({ kind: "sms", t, key: `sms|${id}`, id, addr, body, dir: type === 2 ? "out" : "in" });
  }
  await appendLines(lines);

  const state = (await readJson<FeedState>(STATE)) ?? { feedSince: null, smsLastId: null };
  const feedTimes = lines.filter((l) => l.kind !== "sms").map((l) => l.t);
  if (feedTimes.length) state.feedSince = Math.max(state.feedSince ?? 0, ...feedTimes);
  if (input.sms.length) state.smsLastId = Math.max(state.smsLastId ?? 0, ...input.sms.map((s) => s[0]));
  await writeJson(STATE, state);
  if (Object.keys(input.seenPackages).length) await writeJson(SEEN, input.seenPackages);
}

// Chunks arrive in order from one phone; a gap or restart drops the partial file.
const uploads = new Map<string, number>();

function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base : "shared";
}

async function freePath(name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = join(INBOX, i ? `${stem} (${i})${ext}` : name);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
}

export async function uploadInboxChunk(input: {
  id: string;
  name: string;
  index: number;
  total: number;
  data: string;
}): Promise<{ saved: string | null }> {
  const part = join(INBOX, `.upload-${input.id}.part`);
  const expected = uploads.get(input.id) ?? 0;
  if (input.index !== expected) {
    uploads.delete(input.id);
    await rm(part, { force: true });
    throw new Error(`chunk ${input.index} out of order (expected ${expected})`);
  }
  await mkdir(INBOX, { recursive: true });
  if (input.index === 0) await rm(part, { force: true });
  await appendFile(part, Buffer.from(input.data, "base64"));
  if (input.index + 1 < input.total) {
    uploads.set(input.id, input.index + 1);
    return { saved: null };
  }
  uploads.delete(input.id);
  const dest = await freePath(safeName(input.name));
  await rename(part, dest);
  return { saved: basename(dest) };
}
