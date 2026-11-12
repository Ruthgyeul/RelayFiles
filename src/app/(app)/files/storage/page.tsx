import type { Metadata } from "next";
import { StoragePage } from "@/features/storage/StoragePage";
import { currentDevice } from "@/server/auth/current";
import { storageOverview } from "@/server/services/storage-view.service";
import Loading from "../../loading";

export const metadata: Metadata = { title: "Storage" };

/** "Storage": where the active account's space goes. */
export default async function StorageViewPage() {
  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;
  const { account } = device.active;
  return <StoragePage key={account.id} data={await storageOverview(account)} />;
}
