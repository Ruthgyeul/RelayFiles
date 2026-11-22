import type { Metadata } from "next";
import { RecentlyDeletedPage } from "@/features/trash/RecentlyDeletedPage";
import { listRecentlyDeleted } from "@/server/services/trash.service";
import { withActiveAccount } from "../../with-active-account";

export const metadata: Metadata = { title: "Recently deleted" };

/** "Recently deleted" of the File Manager: deleted items that can be restored until the trash is emptied. */
export default async function DeletedPage() {
  // Keyed by account: switching accounts shows the other account's list, not the state of this one.
  return withActiveAccount(async ({ account }) => <RecentlyDeletedPage key={account.id} initial={await listRecentlyDeleted(account.id)} />);
}
