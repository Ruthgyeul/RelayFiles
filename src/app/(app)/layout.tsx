import { AppShell } from "@/features/shell/AppShell";
import { currentDevice } from "@/server/auth/current";
import { toSessionState } from "@/server/auth/device-session";
import { signupMode } from "@/server/services/auth.service";

/** Application pages: the shell is rendered with the device's signed-in accounts. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const device = await currentDevice();
  const session = await toSessionState(device, await signupMode());
  return <AppShell initialSession={session}>{children}</AppShell>;
}
