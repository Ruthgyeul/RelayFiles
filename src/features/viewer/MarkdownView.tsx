"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/shared/ui/icon/Icon";
import { HighlightedCode } from "./CodeView";

const FENCE_LANGUAGE = /language-([\w+#-]+)/;

/**
 * Raw HTML in the file is not rendered (react-markdown leaves it as text) and pictures are not
 * fetched: a document could otherwise make the visitor's browser call any server.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href?.startsWith("#") ? (
      <a href={href}>{children}</a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
  img: ({ alt }) => (
    <span className="inline-flex items-center gap-1 rounded-md border border-viewer-line px-1.5 text-t4">
      <Icon name="image" />
      {alt || "Image"}
    </span>
  ),
  code: ({ className, children }) => {
    const language = FENCE_LANGUAGE.exec(className ?? "")?.[1];
    return language ? <HighlightedCode text={String(children).replace(/\n$/, "")} language={language} /> : <code>{children}</code>;
  },
};

/** A Markdown file rendered like a README (GitHub-flavored: tables, task lists, strikethrough). */
export default function MarkdownView({ text }: { text: string }) {
  return (
    <article className="markdown-body mx-auto max-w-[760px] px-5 py-4 text-[14px] leading-[1.65] text-t2">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </Markdown>
    </article>
  );
}
