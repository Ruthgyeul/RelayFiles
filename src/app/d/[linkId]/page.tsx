import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ID_PATTERN } from "@/domain/ids";
import { SharePage } from "@/features/share/SharePage";
import { sharePageForRequest } from "@/server/share/page";

/** Share pages are private by nature: keep them out of search engines and link previews. */
export const metadata: Metadata = { title: "Shared with RelayFiles", robots: { index: false, follow: false } };

/** Public share page: `/d/<link>` and `/d/<link>?f=<folder>` for folders inside it. */
export default async function SharedLinkPage({ params, searchParams }: PageProps<"/d/[linkId]">) {
  const { linkId } = await params;
  const { f } = await searchParams;
  if (!ID_PATTERN.link.test(linkId)) notFound();
  const folderId = typeof f === "string" && ID_PATTERN.node.test(f) ? f : null;
  const page = await sharePageForRequest(linkId, folderId);
  if (!page) notFound();
  return <SharePage page={page} />;
}
