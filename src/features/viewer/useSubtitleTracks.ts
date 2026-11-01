"use client";

import { useEffect, useRef, useState } from "react";
import { DOCUMENT_PREVIEW, VIEWER } from "@/config/policy";
import { decodeText } from "@/domain/document";
import { toWebVtt } from "@/domain/subtitles";
import { fetchHead } from "./fetch-head";
import type { SubtitleSource } from "./subtitle-tracks";

export interface SubtitleTrack {
  /** A `blob:` URL of the WebVTT text (CSP media-src allows blob:, nothing from other origins). */
  url: string;
  lang: string | null;
  label: string;
}

/**
 * The video's subtitle files as `<track>` sources: each read with one Range request (at most
 * VIEWER.subtitleMaxBytes, so share links serve it like a text preview), decoded, converted
 * to WebVTT and kept as a blob URL until the video closes. Files that are too large, binary
 * or unreadable are skipped.
 */
export function useSubtitleTracks(sources: readonly SubtitleSource[] | undefined): SubtitleTrack[] {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const key = sources?.map((source) => source.src).join("\n") ?? "";
  const latest = useRef(sources);
  useEffect(() => {
    latest.current = sources;
  });

  useEffect(() => {
    // `key` stands for the list (the parent passes a new array with the same files on every render).
    const list = key ? latest.current : undefined;
    if (!list || list.length === 0) return;
    const abort = new AbortController();
    const urls: string[] = [];
    const load = async (source: SubtitleSource): Promise<SubtitleTrack | null> => {
      const head = await fetchHead(source.src, VIEWER.subtitleMaxBytes, abort.signal).catch(() => null);
      if (!head || head.truncated || abort.signal.aborted) return null;
      const decoded = decodeText(head.bytes, false, DOCUMENT_PREVIEW.sniffBytes);
      if (!decoded) return null;
      const url = URL.createObjectURL(new Blob([toWebVtt(decoded.text, source.format)], { type: "text/vtt" }));
      urls.push(url);
      return { url, lang: source.lang, label: source.label };
    };
    void Promise.all(list.map(load)).then((loaded) => {
      if (!abort.signal.aborted) setTracks(loaded.filter((track): track is SubtitleTrack => track !== null));
    });
    return () => {
      abort.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [key]);

  return sources && sources.length > 0 ? tracks : [];
}
