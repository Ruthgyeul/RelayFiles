import { SUBTITLE_PARAM } from "@/contracts/api";
import { subtitlesFor, type SubtitleFormat } from "@/domain/subtitles";

/** A subtitle file the viewer loads for a video. */
export interface SubtitleSource {
  /** Where the file's text is read from (the owner's or the share link's playback route). */
  src: string;
  format: SubtitleFormat;
  lang: string | null;
  label: string;
}

/**
 * Adds to each video the subtitle files listed beside it (`movie.vtt`, `movie.en.srt`, ...),
 * read from the same playback route as the other items.
 */

export function withSubtitles<T extends { name: string; kind: string; src: string }>(items: readonly T[]): (T & { subtitles?: SubtitleSource[] })[] {
  const names = items.map((item) => item.name);
  const byName = new Map(items.map((item) => [item.name, item]));
  return items.map((item) => {
    if (item.kind !== "video") return item;
    const subtitles = subtitlesFor(item.name, names).flatMap((match) => {
      const file = byName.get(match.name);
      // Marked as a subtitle read: a share link then does not log it as a view of the file.
      return file ? [{ src: withQuery(file.src, `${SUBTITLE_PARAM.name}=${SUBTITLE_PARAM.value}`), format: match.format, lang: match.lang, label: match.label }] : [];
    });
    return subtitles.length > 0 ? { ...item, subtitles } : item;
  });
}

const withQuery = (src: string, query: string) => `${src}${src.includes("?") ? "&" : "?"}${query}`;
