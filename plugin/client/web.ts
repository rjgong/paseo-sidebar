import { openExternalUrl } from "@getpaseo/plugin/client";

// Paseo's opener hands the URL to the desktop host (system default browser) instead of
// window.open, which the desktop app turns into its own built-in browser window.
export async function openExternal(url: string): Promise<void> {
  await openExternalUrl(url);
}
