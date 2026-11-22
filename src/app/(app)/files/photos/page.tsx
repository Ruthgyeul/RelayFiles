import type { Metadata } from "next";
import { PhotosPage } from "@/features/photos/PhotosPage";
import { timeline } from "@/server/services/timeline.service";
import { TIMELINE } from "@/config/policy";
import { withActiveAccount } from "../../with-active-account";

export const metadata: Metadata = { title: "Photos" };

/** "Photos": the active account's photos and videos by the date they were taken. */
export default async function PhotosTimelinePage() {
  return withActiveAccount(async ({ account }) => <PhotosPage key={account.id} initial={await timeline(account.id, { limit: TIMELINE.pageSize })} />);
}
