import { formatSize } from "./format";

/**
 * Owner notifications (docs/runbook.md "알림 설정"): what each event says and the request body
 * each receiver format expects. Pure, so the worker only adds the HTTP call. Visitor addresses,
 * tokens, links and file contents are never part of an event.
 */

export type NotifyFormat = "json" | "ntfy" | "discord" | "telegram";

export interface ArrivedFile {
  name: string;
  size: number;
}

export type NotifyEvent =
  /** Files a visitor sent through an upload-only link, grouped over a short window. */
  | { kind: "file-request"; owner: string; request: string; files: ArrivedFile[]; count: number; bytes: number }
  /** A volume's free space dropped below its reserve: uploads to it are refused. */
  | { kind: "volume-low"; volumeId: string; freeBytes: number; reservePct: number }
  /** The volume watch took a volume offline (marker missing or another volume mounted). */
  | { kind: "volume-offline"; volumeId: string; cause: "missing" | "mismatch" }
  | { kind: "volume-online"; volumeId: string }
  /** An ACTIVE volume refuses writes (e.g. the filesystem was remounted read-only after errors). */
  | { kind: "volume-readonly"; volumeId: string }
  | { kind: "backup-failed"; dump: string | null; problems: string[] };

export type NotifyKind = NotifyEvent["kind"];

export interface NotifyText {
  title: string;
  message: string;
  /** Alerts that need action soon; file arrivals are informational. */
  urgent: boolean;
}

/** Control characters (a newline in a file name) would break the message layout or a header. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const clean = (value: string) => value.replace(CONTROL, " ");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function fileRequestText(event: Extract<NotifyEvent, { kind: "file-request" }>): NotifyText {
  const request = `"${clean(event.request)}"`;
  const owner = clean(event.owner);
  if (event.count === 1 && event.files.length === 1) {
    const [file] = event.files as [ArrivedFile];
    return { title: "File received", message: `"${clean(file.name)}" (${formatSize(file.size)}) arrived through ${request} for ${owner}.`, urgent: false };
  }
  const listed = event.files.map((file) => `- ${clean(file.name)} (${formatSize(file.size)})`);
  const more = event.count - event.files.length;
  return {
    title: "Files received",
    message: [`${plural(event.count, "file")} (${formatSize(event.bytes)}) arrived through ${request} for ${owner}:`, ...listed, ...(more > 0 ? [`and ${more} more`] : [])].join("\n"),
    urgent: false,
  };
}

/** Title, text and urgency of an event, in English like the rest of the UI. */
export function describeEvent(event: NotifyEvent): NotifyText {
  switch (event.kind) {
    case "file-request":
      return fileRequestText(event);
    case "volume-low":
      return {
        title: "Storage volume low",
        message: `Volume ${event.volumeId} has ${formatSize(event.freeBytes)} free, below its ${event.reservePct}% reserve. Uploads to it are refused until space is freed.`,
        urgent: true,
      };
    case "volume-offline":
      return {
        title: "Storage volume offline",
        message:
          event.cause === "missing"
            ? `Volume ${event.volumeId} went offline: its volume marker is missing (the disk is not mounted). Uploads to it stop until it is back.`
            : `Volume ${event.volumeId} went offline: another volume is mounted in its place. Uploads to it stop until it is back.`,
        urgent: true,
      };
    case "volume-online":
      return { title: "Storage volume back online", message: `Volume ${event.volumeId} is mounted again and takes uploads.`, urgent: false };
    case "volume-readonly":
      return {
        title: "Storage volume not writable",
        message: `Volume ${event.volumeId} is mounted but refuses writes (read-only filesystem or disk errors). Uploads to it fail; check the disk (docs/runbook.md "SSD가 빠졌을 때").`,
        urgent: true,
      };
    case "backup-failed":
      return {
        title: "Backup check failed",
        message: [`The backup check${event.dump ? ` of ${clean(event.dump)}` : ""} failed:`, ...event.problems.map((problem) => `- ${clean(problem)}`)].join("\n"),
        urgent: true,
      };
  }
}

/** Cuts text to `max` characters, marking the cut. */
export function truncate(text: string, max: number): string {
  const ELLIPSIS = "…";
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - ELLIPSIS.length))}${ELLIPSIS}`;
}

export interface WebhookOptions {
  format: NotifyFormat;
  /** Origin of the site (PUBLIC_URL), so several servers posting to one channel can be told apart. */
  site: string;
  at: Date;
  /** Longest message text for the format. */
  maxChars: number;
  /** Telegram: the chat to write to. */
  chatId?: string;
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: string;
}

const JSON_TYPE = { "content-type": "application/json" };

/**
 * The request body (and content headers) for one event in the receiver's format. Mentions are
 * switched off for Discord and Telegram gets plain text, so a file name such as "@everyone" or
 * "<b>" is shown as written and pings or formats nothing.
 */
export function webhookRequest(event: NotifyEvent, options: WebhookOptions): WebhookRequest {
  const text = describeEvent(event);
  const message = truncate(text.message, options.maxChars);
  const site = clean(options.site);
  switch (options.format) {
    case "ntfy":
      // Header values must stay ASCII: the titles are fixed English strings, the site is an origin.
      return {
        headers: { "content-type": "text/plain; charset=utf-8", title: `RelayFiles: ${text.title}`, tags: text.urgent ? "warning" : "inbox_tray", priority: text.urgent ? "high" : "default" },
        body: message,
      };
    case "discord":
      return { headers: JSON_TYPE, body: JSON.stringify({ content: truncate(`**${text.title}** (${site})\n${message}`, options.maxChars), allowed_mentions: { parse: [] } }) };
    case "telegram":
      return { headers: JSON_TYPE, body: JSON.stringify({ chat_id: options.chatId, text: truncate(`${text.title} (${site})\n${message}`, options.maxChars), disable_web_page_preview: true }) };
    case "json":
      return { headers: JSON_TYPE, body: JSON.stringify({ event: event.kind, title: text.title, message, urgent: text.urgent, at: options.at.toISOString(), site, data: event }) };
  }
}

/** HTTP statuses worth another try: the receiver is down, busy or timed out. Others mean the setup is wrong. */
export function retryableStatus(status: number): boolean {
  const REQUEST_TIMEOUT = 408;
  const TOO_MANY_REQUESTS = 429;
  const SERVER_ERROR = 500;
  return status === REQUEST_TIMEOUT || status === TOO_MANY_REQUESTS || status >= SERVER_ERROR;
}
