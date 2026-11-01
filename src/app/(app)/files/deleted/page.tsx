import type { Metadata } from "next";
import { RecentlyDeletedPage } from "@/features/trash/RecentlyDeletedPage";
import { currentDevice } from "@/server/auth/current";
import { listRecentlyDeleted } from "@/server/services/trash.service";
import Loading from "../../loading";

export const metadata: Metadata = { title: "Recently deleted" };

/** "Recently deleted" of the File Manager: deleted items that can be restored until the trash is emptied. */
export default async function DeletedPage() {
  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;
  const { id } = device.active.account;
  // Keyed by account: switching accounts shows the other account's list, not the state of this one.
  return <RecentlyDeletedPage key={id} initial={await listRecentlyDeleted(id)} />;
}
