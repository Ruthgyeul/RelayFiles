"use client";

import { useState } from "react";
import { videoNeedsTranscode } from "@/domain/media";

/**
 * The URL a `<video>` plays: the file itself, or the server's conversion for containers
 * browsers cannot decode. A file that turns out not to play (an MKV or MOV with an
 * unsupported codec) switches to the conversion once.
 */
export function useVideoSource(name: string, src: string, transcodeSrc: string | undefined) {
  const [converted, setConverted] = useState(() => transcodeSrc !== undefined && videoNeedsTranscode(name));
  return {
    src: converted && transcodeSrc ? transcodeSrc : src,
    onError: () => {
      if (!converted && transcodeSrc) setConverted(true);
    },
  };
}
