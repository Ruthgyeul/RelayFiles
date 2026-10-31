import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEnv } from "@/config/env";
import { ID_PATTERN } from "@/domain/ids";
import { BYTES_PER_MB } from "@/domain/quota";
import { RequestPage } from "@/features/file-requests/RequestPage";
import { requestPageFor } from "@/server/services/file-request.service";

/** Upload links are private by nature: keep them out of search engines and link previews. */
export const metadata: Metadata = { title: "Send files with RelayFiles", robots: { index: false, follow: false } };

/** Public upload-only link `/r/<id>`: visitors add files to the owner's folder without seeing it. */
export default async function UploadLinkPage({ params }: PageProps<"/r/[requestId]">) {
  const { requestId } = await params;
  if (!ID_PATTERN.fileRequest.test(requestId)) notFound();
  const view = await requestPageFor(requestId);
  if (!view) notFound();
  return <RequestPage view={view} chunkBytes={getEnv("uploads").UPLOAD_CHUNK_SIZE_MB * BYTES_PER_MB} />;
}
