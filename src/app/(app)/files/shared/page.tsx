import type { Metadata } from "next";
import { SharedPage } from "@/features/shared-by-me/SharedPage";
import { collectionsOf } from "@/server/services/collection.service";
import { sharedItems } from "@/server/services/shared-items.service";
import { withActiveAccount } from "../../with-active-account";

export const metadata: Metadata = { title: "Shared by me" };

/** "Shared by me": what of the active account can be opened from outside. */
export default async function SharedByMePage() {
  return withActiveAccount(async ({ account }) => {
    const [data, collections] = await Promise.all([sharedItems(account.id), collectionsOf(account)]);
    return <SharedPage key={account.id} data={data} collections={collections} />;
  });
}
