/** Device detection for the "Signed-in devices" list, ported from the design prototype (`thisSession`). */

export interface DeviceInfo {
  os: string;
  browser: string;
}

/** Same detection order as the prototype: iPad before iPhone, Edge before Chrome before Safari. */
export function parseUserAgent(ua: string): DeviceInfo {
  const os = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return { os, browser };
}

/** Icon shown for a device in the design (mobile, tablet or desktop). */
export function deviceIcon(os: string): "device-mobile" | "device-tablet" | "desktop" {
  if (/iPhone|Android/.test(os)) return "device-mobile";
  if (os === "iPad") return "device-tablet";
  return "desktop";
}
