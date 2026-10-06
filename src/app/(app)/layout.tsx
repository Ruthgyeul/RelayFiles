import { getAppEnv, getEnv } from "@/config/env";
import { AppShell } from "@/features/shell/AppShell";
import { currentDevice } from "@/server/auth/current";
import { toSessionState } from "@/server/auth/device-session";
import { signupMode } from "@/server/services/auth.service";
import { currentAnnouncement } from "@/server/services/server-settings.service";

const BYTES_PER_MB = 1_000_000;

/** Application pages: the shell is rendered with the device's signed-in accounts. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const device = await currentDevice();
  const [session, announcement] = await Promise.all([signupMode().then((mode) => toSessionState(device, mode)), currentAnnouncement()]);
  const config = { publicUrl: getAppEnv().PUBLIC_URL.replace(/\/$/, ""), uploadChunkBytes: getEnv("uploads").UPLOAD_CHUNK_SIZE_MB * BYTES_PER_MB };
  return (
    <AppShell initialSession={session} config={config} announcement={announcement}>
      {children}
    </AppShell>
  );
}
