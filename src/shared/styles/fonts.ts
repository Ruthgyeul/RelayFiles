import { Figtree, JetBrains_Mono } from "next/font/google";

/**
 * Self-hosted fonts (downloaded at build time, no runtime CDN requests).
 * - Figtree: Latin UI text. Variable font, so the design's 400–800 weights render exactly.
 * - JetBrains Mono: tokens, IDs, URLs, paths, keyboard keys.
 * - Pretendard Variable (Hangul fallback) is loaded as a unicode-range split stylesheet in
 *   the root layout, so only the subsets needed for Korean text are downloaded.
 */
export const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
  variable: "--font-figtree",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

/** Class names that expose the font CSS variables on <html>. */
export const fontVariables = `${figtree.variable} ${jetbrainsMono.variable}`;
