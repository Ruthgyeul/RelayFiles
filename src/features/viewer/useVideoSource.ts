"use client";

import { useCallback, useEffect, useState } from "react";
import { CONVERSION, type ConversionKind } from "@/contracts/api";
import { videoNeedsTranscode } from "@/domain/media";
import { hlsPlaylistOf } from "@/shared/lib/files-api";

/** How a video is played: the file, a stored or live conversion, HLS (native or through hls.js), or not chosen yet. */
type Source = "file" | "probing" | "stored" | "native-hls" | "hls-js" | "live";

const HLS_TYPE = "application/vnd.apple.mpegurl";

/**
 * How a converted video plays here: a stored conversion as a file (it seeks with Range), else
 * HLS so seeking anywhere works (Safari natively, other browsers through hls.js on Media
 * Source Extensions), else the live conversion from the start.
 */
async function conversionSource(transcodeSrc: string, video: HTMLVideoElement): Promise<Source> {
  try {
    const head = await fetch(transcodeSrc, { method: "HEAD", credentials: "same-origin" });
    if (head.ok && (head.headers.get(CONVERSION.header) as ConversionKind | null) === "stored") return "stored";
  } catch {
    // Offline for a moment: the player's own request will say more.
  }
  if (!hlsPlaylistOf(transcodeSrc)) return "live";
  if (video.canPlayType(HLS_TYPE)) return "native-hls";
  const { default: Hls } = await import("hls.js/light");
  return Hls.isSupported() ? "hls-js" : "live";
}

/**
 * What a `<video>` plays: the file itself, or the server's conversion for containers browsers
 * cannot decode (chosen by conversionSource). A file that turns out not to play (an MKV or MOV
 * with an unsupported codec) switches to the conversion once; HLS that fails falls back to the
 * live conversion. Pass `attach` as (or call it from) the video's ref.
 */
export function useVideoSource(name: string, src: string, transcodeSrc: string | undefined) {
  const [source, setSource] = useState<Source>(() => (transcodeSrc !== undefined && videoNeedsTranscode(name) ? "probing" : "file"));
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const attach = useCallback((node: HTMLVideoElement | null) => setElement(node), []);

  useEffect(() => {
    if (source !== "probing" || !element || !transcodeSrc) return undefined;
    let cancelled = false;
    void conversionSource(transcodeSrc, element).then((next) => !cancelled && setSource(next));
    return () => {
      cancelled = true;
    };
  }, [source, element, transcodeSrc]);

  useEffect(() => {
    const playlist = transcodeSrc && hlsPlaylistOf(transcodeSrc);
    if (source !== "hls-js" || !element || !playlist) return undefined;
    let cancelled = false;
    let destroy = () => undefined as void;
    void import("hls.js/light").then(({ default: Hls }) => {
      if (cancelled) return;
      // No worker: the CSP allows none, and remuxing a 720p segment on the main thread is cheap.
      const hls = new Hls({ enableWorker: false });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        hls.destroy();
        setSource("live");
      });
      hls.loadSource(playlist);
      hls.attachMedia(element);
      destroy = () => hls.destroy();
    });
    return () => {
      cancelled = true;
      destroy();
    };
  }, [source, element, transcodeSrc]);

  const playlist = transcodeSrc ? hlsPlaylistOf(transcodeSrc) : null;
  const current =
    source === "file" ? src : source === "native-hls" ? (playlist ?? undefined) : source === "stored" || source === "live" ? transcodeSrc : undefined;
  return {
    src: current,
    attach,
    onError: () =>
      setSource((now) => {
        if (now === "file" && transcodeSrc) return "probing";
        return now === "native-hls" ? "live" : now;
      }),
  };
}
