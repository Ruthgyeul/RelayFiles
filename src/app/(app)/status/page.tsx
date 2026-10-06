import type { Metadata } from "next";
import { StatusPage } from "@/features/status/StatusPage";
import { statusData } from "@/server/services/status.service";

export const metadata: Metadata = { title: "Status" };

/** Public service status: live checks from this browser plus the server's probe history. */
export default async function Status() {
  return <StatusPage initial={await statusData()} />;
}
