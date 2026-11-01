import type { Metadata, Viewport } from "next";
// Fonts are self-hosted from npm packages (no build- or run-time requests to font CDNs).
// Each stylesheet is split by unicode-range, so browsers load only the subsets a page uses.
import "@fontsource-variable/figtree/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { connection } from "next/server";
import { APP_WINDOW } from "@/config/theme";
import { currentTheme } from "@/server/services/server-settings.service";
import "@/shared/styles/globals.css";

export const metadata: Metadata = {
  title: "RelayFiles",
  description: "Private file sharing & streaming",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  // The installed app's title bar, like the manifest (app/manifest.ts).
  themeColor: APP_WINDOW.theme,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme (chosen on the Server page) is rendered per request so the first paint already
  // has the right palette and no page keeps the theme it was built with.
  await connection();
  return (
    <html lang="en" data-theme={await currentTheme()}>
      <body>{children}</body>
    </html>
  );
}
