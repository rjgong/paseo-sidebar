import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const bookReadingRpc = defineRpc({
  name: "tasks.book-reading",
  input: z.object({
    action: z.enum(["get", "next", "previous", "select", "sync"]),
    revision: z.number().int().optional(), bookId: z.number().int().optional(),
    expanded: z.boolean().optional(),
  }),
  output: z.object({
    bookId: z.number(), title: z.string(), text: z.string(), location: z.string(), note: z.string(),
    revision: z.number(), hasPrevious: z.boolean(), hasNext: z.boolean(),
    expandedText: z.string(), expandedHasNext: z.boolean(),
    books: z.array(z.object({ id: z.number(), title: z.string() })),
  }),
});
