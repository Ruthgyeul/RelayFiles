import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { getAppEnv } from "@/config/env";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The theme is rendered on the server so the first paint already has the right palette.
  return (
    <html lang="en" data-theme={getAppEnv().DEFAULT_THEME} className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
