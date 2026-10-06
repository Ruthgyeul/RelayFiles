import type { Metadata } from "next";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { currentDevice } from "@/server/auth/current";
import { profileOf } from "@/server/services/profile.service";
import Loading from "../loading";

export const metadata: Metadata = { title: "My Profile" };

/** My Profile and account settings of the active account. */
export default async function SettingsPage() {
  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;
  const data = await profileOf(device.active.account, device.active.sessionId);
  return <ProfilePage data={data} />;
}
