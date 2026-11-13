import { Text, type TextStyle } from "react-native";
import { openExternalUrl } from "@getpaseo/plugin/client";

// 卡片正文和背景里的网址、工作区绝对路径做成可点的链接。
// 网址交给系统浏览器；路径在桌面端经 P:\ 用默认程序打开（同 paseo-open-local 补丁），
// 在手机 fork 上经插件 RPC 拉文件、缓存后交给手机默认程序（同 open-on-device）。

const ROOT = "/srv/paseo-sidebar";
// 路径里有中文，遇到空白、中文标点、引号括号才算结束；末尾的英文标点另外剥掉。
// 没写 https:// 的「域名/路径」也算网址，例如 example.com/documents/guide.html。
const LINK = /(https?:\/\/[^\s，。；、：）」『』“”"'<>]+|(?<![\w./@])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s，。；、：）」『』“”"'<>]*|\/srv\/paseo-sidebar\/[^\s，。；、：）」『』“”"'<>`]+)/g;
const TRAILING = /[.,;:!?)\]]+$/;

const MIME: Record<string, string> = {
  pdf: "application/pdf", html: "text/html", htm: "text/html", md: "text/plain", txt: "text/plain",
  json: "application/json", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", mkv: "video/x-matroska",
};

type Part = { text: string; link?: string };

export function splitLinks(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const raw = m[0], link = raw.replace(TRAILING, ""), at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: link, link });
    last = at + link.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

type FetchFile = (path: string) => Promise<{ name: string; base64: string }>;

async function openPath(path: string, fetchFile: FetchFile): Promise<void> {
  const g = globalThis as any;
  const editor = g.window?.paseoDesktop?.editor;
  if (editor?.openTarget) {
    const local = "P:\\" + path.slice(ROOT.length).replace(/^\//, "").replace(/\//g, "\\");
    await editor.openTarget({ editorId: "explorer", workspacePath: local });
    return;
  }
  const fs = g.expo?.modules?.ExponentFileSystem, opener = g.expo?.modules?.PaseoUsageStats;
  if (!fs?.cacheDirectory || !opener?.openContentUri) throw new Error("这个客户端打不开主机上的文件，请在电脑端或手机改版 Paseo 里点");
  const file = await fetchFile(path);
  const dir = `${String(fs.cacheDirectory).replace(/\/?$/, "/")}host-open/`;
  await fs.makeDirectoryAsync(dir, { intermediates: true });
  const uri = dir + encodeURIComponent(file.name);
  await fs.writeAsStringAsync(uri, file.base64, { encoding: "base64" });
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
  opener.openContentUri(await fs.getContentUriAsync(uri), MIME[ext] ?? "*/*");
}

export function LinkedText({ text, style, linkColor, fetchFile, onError }: {
  text: string; style: TextStyle; linkColor: string; fetchFile: FetchFile; onError: (message: string) => void;
}) {
  return <Text selectable style={style}>
    {splitLinks(text).map((p, i) => p.link
      ? <Text key={i} accessibilityRole="link" style={{ color: linkColor, textDecorationLine: "underline" }}
          onPress={() => {
            const link = p.link!, url = /^https?:\/\//.test(link) ? link : `https://${link}`;
            const done = link.startsWith("/") ? openPath(link, fetchFile) : openExternalUrl(url);
            done.catch((e) => onError(`打不开 ${p.link}：${e instanceof Error ? e.message : String(e)}`));
          }}>{p.text}</Text>
      : p.text)}
  </Text>;
}
