import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { connection } from "next/server";
import { currentTheme } from "@/server/services/server-settings.service";
import { fontVariables } from "@/shared/styles/fonts";
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
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme (chosen on the Server page) is rendered per request so the first paint already
  // has the right palette and no page keeps the theme it was built with.
  await connection();
  return (
    <html lang="en" data-theme={await currentTheme()} className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
