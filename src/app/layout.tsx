import type { Metadata, Viewport } from "next";
import { getEnv } from "@/config/env";
import "./globals.css";

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
    <html lang="en" data-theme={getEnv().DEFAULT_THEME}>
      <body>{children}</body>
    </html>
  );
}
