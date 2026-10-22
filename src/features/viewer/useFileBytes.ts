"use client";

import { useEffect, useState } from "react";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { fetchHead } from "./fetch-head";

export type FileBytes = { status: "loading" } | { status: "error" } | { status: "too-large" } | { status: "ready"; bytes: Uint8Array<ArrayBuffer> };

/** A whole file for a preview that needs all of it (SVG, fonts), unless it is too large to load. */
export function useFileBytes(src: string): FileBytes {
  const [state, setState] = useState<FileBytes>({ status: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    fetchHead(src, DOCUMENT_PREVIEW.assetMaxBytes, abort.signal)
      .then((head) => setState(head.truncated ? { status: "too-large" } : { status: "ready", bytes: new Uint8Array(head.bytes) }))
      .catch(() => {
        if (!abort.signal.aborted) setState({ status: "error" });
      });
    return () => abort.abort();
  }, [src]);
  return state;
}
