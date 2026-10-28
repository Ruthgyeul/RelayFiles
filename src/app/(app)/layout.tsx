import { getAppEnv, getEnv } from "@/config/env";
import { BYTES_PER_MB } from "@/domain/quota";
import { AppShell } from "@/features/shell/AppShell";
import { ShellProvider } from "@/features/shell/ShellProvider";
import { TransfersPanel } from "@/features/transfers/TransfersPanel";
import { TransfersProvider } from "@/features/transfers/TransfersProvider";
import { currentDevice } from "@/server/auth/current";
import { toSessionState } from "@/server/auth/device-session";
import { signupMode } from "@/server/services/auth.service";
import { currentAnnouncement } from "@/server/services/server-settings.service";


/**
 * Application pages: the shell is rendered with the device's signed-in accounts. Transfers
 * sit between the shell state and the frame; composing them here keeps the features acyclic
 * (transfers use the shell, the shell does not import transfers).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const device = await currentDevice();
  const [session, announcement] = await Promise.all([signupMode().then((mode) => toSessionState(device, mode)), currentAnnouncement()]);
  const config = { publicUrl: getAppEnv().PUBLIC_URL.replace(/\/$/, ""), uploadChunkBytes: getEnv("uploads").UPLOAD_CHUNK_SIZE_MB * BYTES_PER_MB };
  return (
    <ShellProvider initialSession={session} config={config}>
      <TransfersProvider>
        <AppShell announcement={announcement}>{children}</AppShell>
        <TransfersPanel />
      </TransfersProvider>
    </ShellProvider>
  );
}
