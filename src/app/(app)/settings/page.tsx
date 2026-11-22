import type { Metadata } from "next";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { profileOf } from "@/server/services/profile.service";
import { withActiveAccount } from "../with-active-account";

export const metadata: Metadata = { title: "My Profile" };

/** My Profile and account settings of the active account. */
export default async function SettingsPage() {
  return withActiveAccount(async (active) => <ProfilePage data={await profileOf(active.account, active.sessionId)} />);
}
