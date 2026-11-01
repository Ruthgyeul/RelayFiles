import { describe, expect, it } from "vitest";
import { describeEvent, retryableStatus, truncate, webhookRequest, type NotifyEvent, type WebhookOptions } from "./notify";

const AT = new Date("2026-11-01T03:04:05.000Z");
const options = (format: WebhookOptions["format"], extra: Partial<WebhookOptions> = {}): WebhookOptions => ({ format, site: "https://files.example.com", at: AT, maxChars: 4_000, ...extra });

const oneFile: NotifyEvent = { kind: "file-request", owner: "anon-k3x9", request: "Trip photos", files: [{ name: "beach.jpg", size: 2_400_000 }], count: 1, bytes: 2_400_000 };

describe("describeEvent", () => {
  it("names one arrived file with its size, the request and the owner", () => {
    expect(describeEvent(oneFile)).toEqual({ title: "File received", message: '"beach.jpg" (2.4 MB) arrived through "Trip photos" for anon-k3x9.', urgent: false });
  });

  it("lists grouped files and counts the ones it leaves out", () => {
    const event: NotifyEvent = { ...oneFile, files: [{ name: "a.jpg", size: 1_000 }, { name: "b.jpg", size: 2_000 }], count: 5, bytes: 9_000 };
    const text = describeEvent(event);
    expect(text.title).toBe("Files received");
    expect(text.message.split("\n")).toEqual(['5 files (9.0 KB) arrived through "Trip photos" for anon-k3x9:', "- a.jpg (1.0 KB)", "- b.jpg (2.0 KB)", "and 3 more"]);
  });

  it("replaces control characters so a file name cannot add lines", () => {
    const text = describeEvent({ ...oneFile, files: [{ name: "evil\nTitle: x.jpg", size: 1 }] });
    expect(text.message).not.toContain("\n");
    expect(text.message).toContain('"evil Title: x.jpg"');
  });

  it("marks storage and backup alerts urgent", () => {
    expect(describeEvent({ kind: "volume-low", volumeId: "v1", freeBytes: 1_000_000_000, reservePct: 5 })).toMatchObject({ title: "Storage volume low", urgent: true });
    expect(describeEvent({ kind: "volume-low", volumeId: "v1", freeBytes: 1_000_000_000, reservePct: 5 }).message).toContain("1.0 GB free, below its 5% reserve");
    expect(describeEvent({ kind: "volume-offline", volumeId: "v1", cause: "missing" }).message).toContain("marker is missing");
    expect(describeEvent({ kind: "volume-offline", volumeId: "v1", cause: "mismatch" }).message).toContain("another volume");
    expect(describeEvent({ kind: "volume-readonly", volumeId: "v1" })).toMatchObject({ title: "Storage volume not writable", urgent: true });
    expect(describeEvent({ kind: "volume-online", volumeId: "v1" }).urgent).toBe(false);
    const backup = describeEvent({ kind: "backup-failed", dump: "relayfiles-2026-11-01.dump", problems: ["newest dump is 30 h old (limit 26 h)", "no accounts in the dump (3 live)"] });
    expect(backup.message.split("\n")).toEqual(["The backup check of relayfiles-2026-11-01.dump failed:", "- newest dump is 30 h old (limit 26 h)", "- no accounts in the dump (3 live)"]);
    expect(describeEvent({ kind: "backup-failed", dump: null, problems: ["x"] }).message).toMatch(/^The backup check failed:/);
  });
});

describe("webhookRequest", () => {
  it("json: the event with its text, time and site", () => {
    const request = webhookRequest(oneFile, options("json"));
    expect(request.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(request.body)).toEqual({
      event: "file-request",
      title: "File received",
      message: '"beach.jpg" (2.4 MB) arrived through "Trip photos" for anon-k3x9.',
      urgent: false,
      at: "2026-11-01T03:04:05.000Z",
      site: "https://files.example.com",
      data: oneFile,
    });
  });

  it("ntfy: plain text body, ASCII title and priority headers", () => {
    const request = webhookRequest({ kind: "volume-readonly", volumeId: "v1" }, options("ntfy"));
    expect(request.headers).toEqual({ "content-type": "text/plain; charset=utf-8", title: "RelayFiles: Storage volume not writable", tags: "warning", priority: "high" });
    expect(request.body).toContain("refuses writes");
    expect(webhookRequest(oneFile, options("ntfy")).headers.priority).toBe("default");
  });

  it("discord: content with mentions disabled", () => {
    const body = JSON.parse(webhookRequest({ ...oneFile, files: [{ name: "@everyone.jpg", size: 1 }] }, options("discord")).body);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toMatch(/^\*\*File received\*\* \(https:\/\/files\.example\.com\)\n"@everyone\.jpg"/);
  });

  it("telegram: plain text to the configured chat", () => {
    const body = JSON.parse(webhookRequest(oneFile, options("telegram", { chatId: "-1001234" })).body);
    expect(body).toEqual({ chat_id: "-1001234", text: expect.stringMatching(/^File received \(https:\/\/files\.example\.com\)\n"beach\.jpg"/), disable_web_page_preview: true });
    expect(body).not.toHaveProperty("parse_mode");
  });

  it("keeps messages within the format's limit", () => {
    const files = Array.from({ length: 10 }, (_, index) => ({ name: `${"x".repeat(300)}-${index}.jpg`, size: 1 }));
    const event: NotifyEvent = { ...oneFile, files, count: 10, bytes: 10 };
    expect(JSON.parse(webhookRequest(event, options("discord", { maxChars: 2_000 })).body).content.length).toBeLessThanOrEqual(2_000);
    expect(webhookRequest(event, options("ntfy", { maxChars: 500 })).body).toHaveLength(500);
  });
});

describe("truncate", () => {
  it("keeps short text and marks a cut", () => {
    expect(truncate("abc", 3)).toBe("abc");
    expect(truncate("abcdef", 4)).toBe("abc…");
  });
});

describe("retryableStatus", () => {
  it("retries timeouts, rate limits and server errors only", () => {
    expect([408, 429, 500, 502, 503].map(retryableStatus)).toEqual([true, true, true, true, true]);
    expect([400, 401, 403, 404, 410].map(retryableStatus)).toEqual([false, false, false, false, false]);
  });
});
