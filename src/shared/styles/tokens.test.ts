import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_KEYS } from "@/config/theme";
import { FIXED_COLOR, KIND_COLOR, THEME_COLOR, TONE } from "./palette";

const themesCss = readFileSync("src/shared/styles/themes.css", "utf8");
const globalsCss = readFileSync("src/shared/styles/globals.css", "utf8");
const designCss = /<style>(:root\{--bg[^<]*)<\/style>/.exec(readFileSync("docs/design/Relay_App.dc.html", "utf8"))?.[1] ?? "";

/** Parses `selector { --a: x; ... }` blocks into a map of selector → declarations. */
function parseBlocks(css: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>();
  for (const [, selector, body] of css.matchAll(/(:root(?:\[data-theme="\w+"\])?)\s*\{([^}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) decls[name!] = value!.trim();
    blocks.set(selector!, decls);
  }
  return blocks;
}

describe("themes.css", () => {
  const ours = parseBlocks(themesCss);
  const design = parseBlocks(designCss);

  it("has the default palette and one block per theme key", () => {
    expect(ours.has(":root")).toBe(true);
    for (const key of THEME_KEYS.filter((k) => k !== "blue")) expect(ours.has(`:root[data-theme="${key}"]`), key).toBe(true);
    expect(ours.size).toBe(10);
  });

  it("matches the design prototype values exactly", () => {
    expect(design.size).toBe(10);
    for (const [selector, decls] of design) expect(ours.get(selector), selector).toEqual(decls);
  });

  it("defines the same 22 variables in every theme", () => {
    const names = Object.keys(ours.get(":root")!).sort();
    expect(names).toHaveLength(22);
    for (const decls of ours.values()) expect(Object.keys(decls).sort()).toEqual(names);
  });
});

describe("palette.ts", () => {
  const defined = new Set([
    ...Object.keys(parseBlocks(themesCss).get(":root")!),
    ...[...globalsCss.matchAll(/(--color-[\w-]+)\s*:/g)].map((m) => m[1]!),
  ]);
  const referenced = [THEME_COLOR, FIXED_COLOR, KIND_COLOR, ...Object.values(TONE)]
    .flatMap((group) => Object.values(group))
    .map((value) => /^var\((--[\w-]+)\)$/.exec(value)?.[1]);

  it("only references CSS variables that exist", () => {
    for (const name of referenced) {
      expect(name, "palette values must be var(--…) references").toBeTruthy();
      expect(defined.has(name!), name).toBe(true);
    }
  });

  it("never contains raw color values", () => {
    const source = readFileSync("src/shared/styles/palette.ts", "utf8");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
