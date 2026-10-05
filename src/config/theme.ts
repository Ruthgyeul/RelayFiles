/**
 * Color themes from the design prototype (docs/design/Relay_App.dc.html, `applyTheme`).
 * The key is written to `<html data-theme>`; `blue` is the unscoped `:root` palette.
 */
export const THEMES = {
  blue: "Midnight Blue",
  lime: "Graphite Lime",
  coral: "Ink Coral",
  amber: "Charcoal Amber",
  teal: "Deep Teal",
  mono: "Mono Black",
  plum: "Plum Violet",
  crimson: "Crimson Rose",
  forest: "Forest Sage",
  sky: "Slate Sky",
} as const;

export type ThemeKey = keyof typeof THEMES;

export const THEME_KEYS = Object.keys(THEMES) as [ThemeKey, ...ThemeKey[]];

/** The design prototype's default theme ("Slate Sky"). */
export const DEFAULT_THEME: ThemeKey = "sky";

export function isThemeKey(value: string): value is ThemeKey {
  return Object.hasOwn(THEMES, value);
}
