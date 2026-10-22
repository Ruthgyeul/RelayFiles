"use client";

import { useEffect, useMemo, useState } from "react";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { lineCount } from "@/domain/document";
import { cn } from "@/shared/lib/cn";
import { highlight } from "./highlight";

/** Highlighted HTML of the text once highlight.js has run, or null (plain text meanwhile). */
export function useHighlighted(text: string, language: string | undefined): string | null {
  const [result, setResult] = useState<{ text: string; language: string; html: string } | null>(null);
  useEffect(() => {
    if (!language || text.length > DOCUMENT_PREVIEW.highlightMaxChars) return;
    let live = true;
    highlight(text, language)
      .then((html) => {
        if (live && html !== null) setResult({ text, language, html });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [text, language]);
  return result && result.text === text && result.language === language ? result.html : null;
}

/** A code element with syntax colors once they are ready. */
export function HighlightedCode({ text, language, className }: { text: string; language: string | undefined; className?: string }) {
  const html = useHighlighted(text, language);
  // highlight.js escapes the source; its markup is only the token spans.
  return html === null ? <code className={className}>{text}</code> : <code className={cn("hljs", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Source text with line numbers (hidden while lines wrap, where they would no longer line up)
 * and syntax colors for its language.
 */
export function CodeView({ text, language, wrap }: { text: string; language: string | undefined; wrap: boolean }) {
  const numbers = useMemo(() => Array.from({ length: Math.max(1, lineCount(text)) }, (_, index) => index + 1).join("\n"), [text]);
  return (
    <div className={cn("flex font-mono text-[13px] leading-[1.6]", wrap ? "w-full" : "w-max min-w-full")}>
      {!wrap && (
        <pre aria-hidden className="sticky left-0 m-0 shrink-0 border-r border-viewer-line bg-black py-3 pr-3 pl-4 text-right text-t5 select-none">
          {numbers}
        </pre>
      )}
      <pre className={cn("m-0 min-w-0 flex-1 px-4 py-3 text-t2", wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre")}>
        <HighlightedCode text={text} language={language} />
      </pre>
    </div>
  );
}
