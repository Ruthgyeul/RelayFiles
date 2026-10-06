import { describe, expect, it } from "vitest";
import { deviceIcon, parseUserAgent } from "./device";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

describe("parseUserAgent", () => {
  it.each([
    [UA.iphone, "iPhone", "Safari"],
    [UA.ipad, "iPad", "Safari"],
    [UA.android, "Android", "Chrome"],
    [UA.edge, "Windows", "Edge"],
    [UA.firefox, "Linux", "Firefox"],
    [UA.safariMac, "Mac", "Safari"],
    ["curl/8.0", "Unknown", "Browser"],
  ])("%s", (ua, os, browser) => {
    expect(parseUserAgent(ua)).toEqual({ os, browser });
  });
});

describe("deviceIcon", () => {
  it("matches the design", () => {
    expect(deviceIcon("iPhone")).toBe("device-mobile");
    expect(deviceIcon("Android")).toBe("device-mobile");
    expect(deviceIcon("iPad")).toBe("device-tablet");
    expect(deviceIcon("Windows")).toBe("desktop");
  });
});
