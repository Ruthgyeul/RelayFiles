import type { Metadata } from "next";
import { shareTargetState } from "@/domain/share-target";
import { ShareTargetPage } from "@/features/pwa/ShareTargetPage";

export const metadata: Metadata = { title: "Upload shared files" };

/**
 * Files shared to the installed app from another app (Web Share Target). The service worker took
 * the share sheet's post and sent the browser here with an id; the page collects the files from
 * it and uploads them to a new Home folder once the signed-in user confirms.
 */
export default async function ShareTarget({ searchParams }: PageProps<"/share-target">) {
  return <ShareTargetPage state={shareTargetState(await searchParams)} />;
}
