/**
 * Subtitles next to a video: `movie.mp4` plays with `movie.vtt`, `movie.srt` and tagged files
 * such as `movie.en.srt` or `movie.ko.vtt` from the same folder. SubRip (.srt) is converted to
 * WebVTT, the only format `<track>` reads.
 */

export type SubtitleFormat = "vtt" | "srt";

export interface SubtitleMatch {
  /** The sibling file's name. */
  name: string;
  format: SubtitleFormat;
  /** BCP 47 language from the tag (`movie.en.srt`), or null. */
  lang: string | null;
  /** Menu label: the language name, the tag, or "Subtitles". */
  label: string;
}

const SUBTITLE_FILE = /^(.*)\.(vtt|srt)$/i;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
const DEFAULT_LABEL = "Subtitles";

const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || name;

function languageName(tag: string): string | null {
  try {
    return new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(tag) ?? null;
  } catch {
    return null;
  }
}

/** Whether a file name is a subtitle file the viewer can load. */
export function isSubtitleName(name: string): boolean {
  return SUBTITLE_FILE.test(name);
}

/**
 * The subtitle files among `siblings` that belong to the video `videoName` (same base name or
 * full name, compared without case), untagged first, then by label. Labels that would repeat get the
 * format added ("Subtitles (VTT)", "Subtitles (SRT)").
 */
export function subtitlesFor(videoName: string, siblings: readonly string[]): SubtitleMatch[] {
  // `movie.mp4` matches `movie.srt` and `movie.mp4.srt` alike.
  const stems = new Set([baseName(videoName).toLowerCase(), videoName.toLowerCase()]);
  const found: (SubtitleMatch & { tagged: boolean })[] = [];
  for (const name of siblings) {
    const match = SUBTITLE_FILE.exec(name);
    if (!match) continue;
    const stem = match[1]!;
    const format = match[2]!.toLowerCase() as SubtitleFormat;
    if (stems.has(stem.toLowerCase())) {
      found.push({ name, format, lang: null, label: DEFAULT_LABEL, tagged: false });
      continue;
    }
    const dot = stem.lastIndexOf(".");
    if (dot <= 0 || !stems.has(stem.slice(0, dot).toLowerCase())) continue;
    const tag = stem.slice(dot + 1);
    if (!tag) continue;
    const language = LANGUAGE_TAG.test(tag) ? languageName(tag) : null;
    found.push({ name, format, lang: language ? tag : null, label: language ?? tag, tagged: true });
  }
  found.sort((a, b) => Number(a.tagged) - Number(b.tagged) || a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
  const counts = new Map<string, number>();
  for (const entry of found) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
  return found.map(({ name, format, lang, label }) => ({ name, format, lang, label: counts.get(label)! > 1 ? `${label} (${format.toUpperCase()})` : label }));
}

const TIMESTAMP = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/g;
const TIMING_LINE = /^\s*(\d+:\d{1,2}:\d{1,2}[,.]\d{1,3})\s*-->\s*(\d+:\d{1,2}:\d{1,2}[,.]\d{1,3})/;
/** Tags WebVTT cue text understands; anything else (SubRip's <font>, stray `<`) is dropped or escaped. */
const VTT_TAG = /^<\/?(i|b|u)>/i;

function vttTime(stamp: string): string {
  return stamp.replace(TIMESTAMP, (_, h: string, m: string, s: string, ms: string) => `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.padStart(2, "0")}.${ms.padEnd(3, "0")}`);
}

/** Cue text as WebVTT wants it: `&`, `<` and `>` escaped except entities and <i>/<b>/<u> (so no "-->"). */
function vttText(line: string): string {
  let out = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === "<") {
      const rest = line.slice(index);
      const tag = VTT_TAG.exec(rest)?.[0];
      if (tag) {
        out += tag.toLowerCase();
        index += tag.length - 1;
        continue;
      }
      const other = /^<\/?font\b[^>]*>/i.exec(rest)?.[0];
      if (other) {
        index += other.length - 1;
        continue;
      }
      out += "&lt;";
    } else if (char === "&") {
      out += /^&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(line.slice(index)) ? "&" : "&amp;";
    } else if (char === ">") {
      // Every literal ">" is escaped, so the text can never hold the cue timing arrow "-->".
      out += "&gt;";
    } else out += char;
  }
  return out;
}

/** SubRip text as WebVTT: numbered blocks become cues, commas in times become dots. */
export function srtToVtt(srt: string): string {
  const blocks = srt.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
  const cues: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingAt = lines.findIndex((line) => TIMING_LINE.test(line));
    if (timingAt < 0) continue;
    const [, start, end] = TIMING_LINE.exec(lines[timingAt]!)!;
    const text = lines
      .slice(timingAt + 1)
      .map(vttText)
      .filter((line) => line.trim() !== "");
    cues.push([`${vttTime(start!)} --> ${vttTime(end!)}`, ...text].join("\n"));
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** A subtitle file's text as WebVTT (a .vtt file without its header gets one). */
export function toWebVtt(text: string, format: SubtitleFormat): string {
  if (format === "srt") return srtToVtt(text);
  const body = text.replace(/^﻿/, "");
  return /^WEBVTT(?:[ \t\n\r]|$)/.test(body) ? body : `WEBVTT\n\n${body}`;
}
