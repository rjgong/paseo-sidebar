import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const musicBeeStateSchema = z.object({
  online: z.boolean(), title: z.string(), artist: z.string(), playing: z.boolean(),
  position: z.number(), duration: z.number(), shuffle: z.boolean(), repeat: z.number(),
  playlist: z.string(), hasTrack: z.boolean(), message: z.string(),
});
export const musicBeeRpc = defineRpc({
  name: "tasks.musicbee",
  input: z.object({
    action: z.enum(["status", "start", "toggle", "previous", "next", "seek", "shuffle", "repeat", "play-playlist"]),
    playlistId: z.string().max(4096).optional(), position: z.number().int().nonnegative().optional(),
  }),
  output: musicBeeStateSchema,
});
export const musicBeePlaylistsRpc = defineRpc({
  name: "tasks.musicbee-playlists", input: z.object({}),
  output: z.object({ playlists: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().optional(), folder: z.boolean().optional() })) }),
});
