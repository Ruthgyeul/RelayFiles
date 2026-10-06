import { forbidden } from "next/navigation";
import { currentDevice } from "@/server/auth/current";
import Loading from "../loading";

/** Admin pages: members get the 403 page (the proxy may also restrict by address). */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;
  if (!device.active.account.isAdmin) forbidden();
  return children;
}
