import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { ServerPage } from "@/features/admin/ServerPage";
import { currentDevice } from "@/server/auth/current";
import { serverSnapshot } from "@/server/services/server-metrics.service";
import { serverSettings } from "@/server/services/server-settings.service";

export const metadata: Metadata = { title: "Server" };

/** Admin: announcement, server metrics, sign-up mode and theme. */
export default async function AdminServerPage() {
  const device = await currentDevice();
  if (!device.active) return null;
  if (!device.active.account.isAdmin) forbidden();
  const [settings, snapshot] = await Promise.all([serverSettings(), serverSnapshot()]);
  return <ServerPage settings={settings} snapshot={snapshot} />;
}
