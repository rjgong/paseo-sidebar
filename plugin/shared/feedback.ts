// Ported from cursor-tasks media/taskFeedback.js and media/notificationView.js.
const CONTENT_LINK_RE = /\s+(?:https?|mybooks):\/\/\S+\s*$/i;
const CONTENT_LINK_ONLY_RE = /^(?:https?|mybooks):\/\/\S+$/i;
const TECHNICAL_MARKER_RE = /^[a-z][a-z0-9_]*=/i;
const HIDDEN_PREFIXES = ["所有书籍合并", "折算：", "本任务只作为"];
const READING_PREFIXES = ["本书：", "当前章节：", "当前位置：", "当前工作量："];

export function compactText(value: string, limit = 160): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function visibleDescriptionLines(value: string): string[] {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => compactText(line, 150))
    .filter(Boolean)
    .filter((line) => !TECHNICAL_MARKER_RE.test(line))
    .filter((line) => !CONTENT_LINK_ONLY_RE.test(line))
    .filter((line) => !HIDDEN_PREFIXES.some((prefix) => line.startsWith(prefix)));
}

export interface ReceiptView {
  kicker: string;
  title: string;
  details: string[];
  next: string;
}

export function buildCompletionReceipt(payload: {
  name: string;
  description: string;
  tag: string;
  releasedNext: string;
}): ReceiptView {
  const tag = payload.tag.trim();
  const kicker = tag === "课外" || /^阅读《/.test(payload.name) || /^读《/.test(payload.name)
    ? "阅读落下一页"
    : tag === "正事" ? "工作落下一块" : "刚刚留下成果";
  const lines = visibleDescriptionLines(payload.description);
  const reading = lines.filter((line) => READING_PREFIXES.some((prefix) => line.startsWith(prefix)));
  const releasedNext = compactText(payload.releasedNext, 120);
  return {
    kicker,
    title: compactText(payload.name.replace(CONTENT_LINK_RE, ""), 120) || "完成了一项",
    details: (reading.length ? reading : lines).slice(0, 2),
    next: releasedNext ? `下一段已解锁：${releasedNext}` : "",
  };
}

export function visibleNotificationDescription(value: string): string {
  const lines = String(value || "").split(/\r?\n/);
  const hidden = ["notification_event_id=", "来源:", "发生时间:"];
  let first = 0;
  while (first < lines.length) {
    const line = lines[first].trim();
    if (!line || hidden.some((prefix) => line.startsWith(prefix))) {
      first += 1;
      continue;
    }
    break;
  }
  return lines.slice(first).join("\n").trim();
}
