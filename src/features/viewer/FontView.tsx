"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { FailedPreview, LoadingPreview } from "./PreviewMessage";
import { useFileBytes } from "./useFileBytes";

/** The first sample at each size, then every sample at the body size. */
const SAMPLE_SIZES = [40, 28, 14] as const;
const BODY_SIZE = 20;
const SAMPLES = [
  "The quick brown fox jumps over the lazy dog",
  "다람쥐 헌 쳇바퀴에 타고파",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz",
  "0123456789 !@#$%^&*()[]{}<>?/",
] as const;

/** A font file shown as sample text in several sizes (loaded for this page only). */
export function FontView({ src, tooLarge }: { src: string; tooLarge: ReactNode }) {
  const file = useFileBytes(src);
  const family = `preview-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (file.status !== "ready") return;
    const face = new FontFace(family, file.bytes);
    let live = true;
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        if (live) setState("ready");
      })
      .catch(() => {
        if (live) setState("error");
      });
    return () => {
      live = false;
      document.fonts.delete(face);
    };
  }, [file, family]);

  if (file.status === "error" || state === "error") return <FailedPreview />;
  if (file.status === "too-large") return tooLarge;
  if (state === "loading") return <LoadingPreview />;
  return (
    <div className="flex size-full flex-col gap-5 overflow-auto px-6 py-5 text-t1" style={{ fontFamily: `"${family}"` }}>
      {SAMPLE_SIZES.map((size) => (
        <p key={size} className="m-0 leading-[1.3] break-words" style={{ fontSize: size }}>
          {SAMPLES[0]}
        </p>
      ))}
      {SAMPLES.slice(1).map((sample) => (
        <p key={sample} className="m-0 leading-[1.4] break-words" style={{ fontSize: BODY_SIZE }}>
          {sample}
        </p>
      ))}
    </div>
  );
}
