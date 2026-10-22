"use client";

import { useEffect, useState } from "react";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { decodeText, looksBinary, type DecodedText } from "@/domain/document";
import { fetchHead } from "./fetch-head";

export type FileText =
  | { status: "loading" }
  | { status: "error" }
  | { status: "binary" }
  | ({ status: "ready"; truncated: boolean; total: number | null; /** Bytes read. */ shown: number } & DecodedText);

/**
 * The start of a text file, decoded. With `sniff` (a type not known to be text) the first
 * few kilobytes are checked before the rest is fetched, so a large binary file costs one
 * small request. The viewer mounts one per file, so `src` does not change during its life.
 */
export function useFileText(src: string, sniff: boolean): FileText {
  const [state, setState] = useState<FileText>({ status: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    const load = async (): Promise<FileText> => {
      const probe = sniff ? await fetchHead(src, DOCUMENT_PREVIEW.sniffBytes, abort.signal) : null;
      if (probe && looksBinary(probe.bytes, DOCUMENT_PREVIEW.sniffBytes)) return { status: "binary" };
      // A file that fit in the probe is already complete.
      const head = probe && !probe.truncated ? probe : await fetchHead(src, DOCUMENT_PREVIEW.textMaxBytes, abort.signal);
      const decoded = decodeText(head.bytes, head.truncated, DOCUMENT_PREVIEW.sniffBytes);
      return decoded ? { status: "ready", truncated: head.truncated, total: head.total, shown: head.bytes.length, ...decoded } : { status: "binary" };
    };
    load()
      .then(setState)
      .catch(() => {
        if (!abort.signal.aborted) setState({ status: "error" });
      });
    return () => abort.abort();
  }, [src, sniff]);
  return state;
}
