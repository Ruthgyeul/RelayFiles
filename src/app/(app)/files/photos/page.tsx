import type { Metadata } from "next";
import { PhotosPage } from "@/features/photos/PhotosPage";
import { currentDevice } from "@/server/auth/current";
import { timeline } from "@/server/services/timeline.service";
import { TIMELINE } from "@/config/policy";
import Loading from "../../loading";

export const metadata: Metadata = { title: "Photos" };

/** "Photos": the active account's photos and videos by the date they were taken. */
export default async function PhotosTimelinePage() {
  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;
  const { account } = device.active;
  return <PhotosPage key={account.id} initial={await timeline(account.id, { limit: TIMELINE.pageSize })} />;
}
