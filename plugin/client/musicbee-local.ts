import { z } from "zod";
import { musicBeeRpc, musicBeePlaylistsRpc, musicBeeStateSchema } from "../shared/musicbee";

type LocalHost = {
  getToken(): Promise<string>;
  start(): Promise<void>;
};
function host(): LocalHost {
  const desktop = (globalThis as typeof globalThis & { paseoMusicBee?: LocalHost }).paseoMusicBee;
  if (!desktop) throw new Error("MusicBee 本机连接尚未就绪，请重新打开 Paseo 桌面端");
  return desktop;
}
export async function localMusicBeeRequest(input: Record<string, unknown>): Promise<unknown> {
  const token = await host().getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("http://127.0.0.1:18877/rpc", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input), signal: controller.signal, credentials: "omit",
    });
    const value: unknown = await response.json();
    if (value && typeof value === "object" && "error" in value) throw new Error(String(value.error));
    if (!response.ok) throw new Error(`MusicBee 本机请求失败 (${response.status})`);
    return value;
  } finally { clearTimeout(timeout); }
}
const offline = {
  online: false, title: "", artist: "", playing: false, position: 0, duration: 0,
  shuffle: false, repeat: 0, playlist: "", hasTrack: false, message: "MusicBee 未连接，点击打开",
};
export async function localMusicBee(input: z.infer<typeof musicBeeRpc.input>) {
  if (input.action === "start") {
    await host().start();
    for (let attempt = 0; attempt < 15; attempt++) {
      try { return musicBeeStateSchema.parse(await localMusicBeeRequest({ action: "status" })); } catch { }
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    throw new Error("已请求启动 MusicBee，请稍后重试");
  }
  try { return musicBeeStateSchema.parse(await localMusicBeeRequest(input)); }
  catch (error) {
    if (input.action !== "status") throw error;
    return { ...offline, message: error instanceof Error && error.message.includes("尚未就绪") ? error.message : offline.message };
  }
}
export async function localMusicBeePlaylists(_input: Record<string, never>) {
  return musicBeePlaylistsRpc.output.parse(await localMusicBeeRequest({ action: "playlists" }));
}
