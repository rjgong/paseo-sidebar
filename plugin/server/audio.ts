import { appendFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

// All-day recording from the forked Android app (PaseoRecorderService). Each 10-minute
// window arrives as <yyyyMMdd-HHmmss>.m4a (voiced stretches only, may be absent) and a
// .json sidecar sent after it. /srv/paseo-sidebar/scripts/tasks/phone_audio.py transcribes complete
// pairs and deletes the audio. config.json {"enabled": bool} is the on/off switch.
// The recorder normally PUTs files itself to uploadUrl (/srv/paseo-sidebar/scripts/tasks/phone_audio_recv.py);
// audio.upload below is the fallback while the app is open.
const DIR = "/srv/paseo-sidebar/assistant/butler/phone-audio";
const CONFIG = join(DIR, "config.json");

export async function audioStatus(): Promise<{
  audioEnabled: boolean;
  audioUploadUrl: string | null;
  audioUploadToken: string | null;
}> {
  try {
    const config = JSON.parse(await readFile(CONFIG, "utf8")) as {
      enabled?: boolean;
      uploadUrl?: string;
      uploadToken?: string;
    };
    return {
      audioEnabled: config.enabled === true,
      audioUploadUrl: config.uploadUrl ?? null,
      audioUploadToken: config.uploadToken ?? null,
    };
  } catch {
    return { audioEnabled: false, audioUploadUrl: null, audioUploadToken: null };
  }
}

// Chunks of one file arrive in order; a restarted upload begins again at index 0.
const uploads = new Map<string, number>();

export async function uploadAudioChunk(input: {
  name: string;
  index: number;
  total: number;
  data: string;
}): Promise<void> {
  const day = `${input.name.slice(0, 4)}-${input.name.slice(4, 6)}-${input.name.slice(6, 8)}`;
  const dir = join(DIR, day);
  const part = join(dir, `.${input.name}.part`);
  const expected = input.index === 0 ? 0 : (uploads.get(input.name) ?? -1);
  if (input.index !== expected) {
    uploads.delete(input.name);
    throw new Error(`chunk ${input.index} out of order (expected ${expected})`);
  }
  await mkdir(dir, { recursive: true });
  if (input.index === 0) await rm(part, { force: true });
  await appendFile(part, Buffer.from(input.data, "base64"));
  if (input.index + 1 < input.total) {
    uploads.set(input.name, input.index + 1);
    return;
  }
  uploads.delete(input.name);
  await rename(part, join(dir, input.name));
}
