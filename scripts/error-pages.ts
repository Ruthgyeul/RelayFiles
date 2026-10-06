/**
 * Static error pages for Nginx (deploy/error-pages): what visitors see when the app itself
 * is down (502/504) or the server is in maintenance (503). They mirror ErrorScreen with
 * the design's tokens inlined, because nothing from the app can be loaded at that point.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ERROR_PRESETS, type ErrorPreset } from "../src/features/errors/presets";
import { TONE } from "../src/shared/styles/palette";
import { ICONS } from "../src/shared/ui/icon/registry";

const STYLES_DIR = new URL("../src/shared/styles/", import.meta.url);

/** The default (sky) theme and every fixed palette color, as CSS custom properties. */
function tokens(): string {
  const themes = readFileSync(new URL("themes.css", STYLES_DIR), "utf8");
  const sky = /:root\[data-theme="sky"\]\s*\{([^}]*)\}/.exec(themes)?.[1];
  if (!sky) throw new Error("The sky theme is missing from themes.css.");
  const globals = readFileSync(new URL("globals.css", STYLES_DIR), "utf8");
  const fixed = globals.match(/--color-[a-z0-9-]+:\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\));/g) ?? [];
  return `${sky.trim().split(/\s*\n\s*/).join("")}${fixed.join("")}`;
}

const svg = (name: keyof typeof ICONS, size: number, color: string, weight: "fill" | "bold") => renderToStaticMarkup(createElement(ICONS[name], { size, weight, color, "aria-hidden": true }));

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function page(preset: ErrorPreset, code: string): string {
  const tone = TONE[preset.tone];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escape(preset.title)} · RelayFiles</title>
<style>
:root{${tokens()}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;flex-direction:column;background:var(--bg);color:var(--t1);font-family:Figtree,Pretendard,system-ui,-apple-system,"Segoe UI",sans-serif}
header{height:60px;flex:none;display:flex;align-items:center;gap:10px;padding:0 20px;border-bottom:1px solid var(--line);background:var(--header);font-size:18px;font-weight:700}
.logo{width:28px;height:28px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px}
section{width:min(440px,100%);display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px 24px;border-radius:16px;border:1px solid var(--cardLine);background:var(--card);text-align:center}
.icon{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:${tone.bg}}
.badge{padding:2px 7px;border-radius:999px;background:${tone.bg};color:${tone.text};font:600 12px ui-monospace,"JetBrains Mono",monospace}
h1{margin:0;font-size:19px;font-weight:700}
p{margin:0;font-size:14px;line-height:1.5;color:var(--t3);text-wrap:pretty}
a.retry{margin-top:4px;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--accent);background:var(--accent);color:var(--onAccent);font-size:14px;font-weight:700;text-decoration:none}
a.retry:focus-visible{outline:2px solid var(--accentHi);outline-offset:2px}
@media (max-width:719px){a.retry{width:100%}}
</style>
</head>
<body>
<header><span class="logo">${svg("arrow-up-right", 15, "var(--onAccent)", "bold")}</span>RelayFiles</header>
<main>
<section aria-labelledby="error-title">
<span class="icon">${svg(preset.icon, 26, tone.icon, "fill")}</span>
<span class="badge">${escape(code)}</span>
<h1 id="error-title">${escape(preset.title)}</h1>
<p>${escape(preset.description)}</p>
<a class="retry" href="">${svg("arrows-clockwise", 16, "currentColor", "bold")}Retry</a>
</section>
</main>
</body>
</html>
`;
}

/** File name → HTML for every page Nginx serves itself. */
export function renderErrorPages(): Record<string, string> {
  return {
    "502.html": page(ERROR_PRESETS["502"], "502"),
    "503.html": page(ERROR_PRESETS["503"], "503"),
    "504.html": page(ERROR_PRESETS["502"], "504"),
  };
}
