import type { Metadata } from "next";
import { StoragePage } from "@/features/storage/StoragePage";
import { storageOverview } from "@/server/services/storage-view.service";
import { withActiveAccount } from "../../with-active-account";

export const metadata: Metadata = { title: "Storage" };

/** "Storage": where the active account's space goes. */
export default async function StorageViewPage() {
  return withActiveAccount(async ({ account }) => <StoragePage key={account.id} data={await storageOverview(account)} />);
}
