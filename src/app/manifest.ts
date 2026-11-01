import type { MetadataRoute } from "next";
import { SHARE_TARGET } from "@/config/policy";
import { APP_WINDOW } from "@/config/theme";

/**
 * Web app manifest (/manifest.webmanifest): installs RelayFiles as an app and offers it in the
 * system share sheet for files of any type (Web Share Target, docs/architecture.md "설치 앱과 공유
 * 대상"). Static: built once, the same for every visitor. Icons: scripts/pwa-icons.mts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RelayFiles",
    short_name: "RelayFiles",
    description: "Private file sharing & streaming",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: APP_WINDOW.background,
    theme_color: APP_WINDOW.theme,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: SHARE_TARGET.action,
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: SHARE_TARGET.filesField, accept: ["*/*"] }] },
    },
  };
}
