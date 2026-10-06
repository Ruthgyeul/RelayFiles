import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { AccountsPage } from "@/features/admin/AccountsPage";
import { currentDevice } from "@/server/auth/current";
import { listAccounts } from "@/server/services/admin.service";

export const metadata: Metadata = { title: "Accounts" };

/** Admin: every account with usage, deletion dates and Manage. */
export default async function AdminAccountsPage() {
  const device = await currentDevice();
  // The layout shows the loading state until the first account exists, and guards too,
  // but it may render alongside the page.
  if (!device.active) return null;
  if (!device.active.account.isAdmin) forbidden();
  const data = await listAccounts(
    device.accounts.map((entry) => entry.account.id),
    device.active.account.id,
  );
  return <AccountsPage data={data} />;
}
