/**
 * Named references to the design's color tokens for places where a color is chosen
 * from data (file kind, status level, option state) and passed as an inline style.
 * The values live only in globals.css / themes.css; this file never holds hex codes.
 */
const cssVar = <T extends string>(name: T) => `var(--${name})` as const;

/** Theme-dependent colors (switch with <html data-theme>). */
export const THEME_COLOR = {
  bg: cssVar("bg"),
  header: cssVar("header"),
  sunk: cssVar("sunk"),
  card: cssVar("card"),
  elev: cssVar("elev"),
  btn: cssVar("btn"),
  btnH: cssVar("btnH"),
  line: cssVar("line"),
  cardLine: cssVar("cardLine"),
  ctrl: cssVar("ctrl"),
  t1: cssVar("t1"),
  t2: cssVar("t2"),
  t3: cssVar("t3"),
  t4: cssVar("t4"),
  t5: cssVar("t5"),
  accent: cssVar("accent"),
  accentHi: cssVar("accentHi"),
  accentIcon: cssVar("accentIcon"),
  accentText: cssVar("accentText"),
  accentSoft: cssVar("accentSoft"),
  accentSoftLine: cssVar("accentSoftLine"),
  onAccent: cssVar("onAccent"),
} as const;

/** Colors the design hardcodes regardless of theme. */
export const FIXED_COLOR = {
  ok: cssVar("color-ok"),
  okText: cssVar("color-ok-text"),
  okBg: cssVar("color-ok-bg"),
  okBgStrong: cssVar("color-ok-bg-strong"),
  okLine: cssVar("color-ok-line"),
  okBar: cssVar("color-ok-bar"),
  warnText: cssVar("color-warn-text"),
  warnStrong: cssVar("color-warn-strong"),
  warnOrange: cssVar("color-warn-orange"),
  warnBg: cssVar("color-warn-bg"),
  warnLine: cssVar("color-warn-line"),
  warnBgSoft: cssVar("color-warn-bg-soft"),
  warnBgOrange: cssVar("color-warn-bg-orange"),
  warnPale: cssVar("color-warn-pale"),
  warnInk: cssVar("color-warn-ink"),
  dangerText: cssVar("color-danger-text"),
  dangerIcon: cssVar("color-danger-icon"),
  dangerSolid: cssVar("color-danger-solid"),
  dangerBg: cssVar("color-danger-bg"),
  dangerLine: cssVar("color-danger-line"),
  dangerBgStrong: cssVar("color-danger-bg-strong"),
  dangerPale: cssVar("color-danger-pale"),
  infoText: cssVar("color-info-text"),
  infoBg: cssVar("color-info-bg"),
  infoLine: cssVar("color-info-line"),
  cyan: cssVar("color-cyan"),
  cyanBg: cssVar("color-cyan-bg"),
  memoryBg: cssVar("color-memory-bg"),
} as const;

/** File kind colors (`KIND` in the design). */
export const KIND_COLOR = {
  folder: cssVar("color-kind-folder"),
  video: cssVar("color-kind-video"),
  audio: cssVar("color-kind-audio"),
  image: cssVar("color-kind-image"),
  other: cssVar("color-kind-other"),
} as const;

/** A status level used by banners, pills and status cards. */
export type Tone = "accent" | "ok" | "warn" | "danger" | "info";

/** Background / border / text triplets per tone, as used across the design's banners and pills. */
export const TONE = {
  accent: { bg: THEME_COLOR.accentSoft, border: THEME_COLOR.accentSoftLine, text: THEME_COLOR.accentText, icon: THEME_COLOR.accentIcon },
  ok: { bg: FIXED_COLOR.okBg, border: FIXED_COLOR.okLine, text: FIXED_COLOR.okText, icon: FIXED_COLOR.okText },
  warn: { bg: FIXED_COLOR.warnBg, border: FIXED_COLOR.warnLine, text: FIXED_COLOR.warnText, icon: FIXED_COLOR.warnText },
  danger: { bg: FIXED_COLOR.dangerBg, border: FIXED_COLOR.dangerLine, text: FIXED_COLOR.dangerText, icon: FIXED_COLOR.dangerIcon },
  info: { bg: FIXED_COLOR.infoBg, border: FIXED_COLOR.infoLine, text: FIXED_COLOR.infoText, icon: FIXED_COLOR.infoText },
} as const satisfies Record<Tone, { bg: string; border: string; text: string; icon: string }>;

export type PaletteRef = (typeof THEME_COLOR)[keyof typeof THEME_COLOR] | (typeof FIXED_COLOR)[keyof typeof FIXED_COLOR];
