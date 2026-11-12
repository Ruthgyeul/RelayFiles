import type { Metadata } from "next";
import { SharedPage } from "@/features/shared-by-me/SharedPage";
import { currentDevice } from "@/server/auth/current";
import { sharedItems } from "@/server/services/shared-items.service";
import Loading from "../../loading";

export const metadata: Metadata = { title: "Shared by me" };

/** "Shared by me": what of the active account can be opened from outside. */
export default async function SharedByMePage() {
  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;
  const { account } = device.active;
  return <SharedPage key={account.id} data={await sharedItems(account.id)} />;
}
