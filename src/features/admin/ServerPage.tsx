"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ServerSnapshot } from "@/contracts/server-metrics";
import type { ServerSettings } from "@/contracts/server-settings";
import { usePageTitle } from "@/features/shell/page-title";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError } from "@/shared/lib/api-client";
import { AnnouncementCard } from "./AnnouncementCard";
import { ServerMetrics } from "./ServerMetrics";
import { settingsApi } from "./settings-api";
import { SignupCard } from "./SignupCard";
import { ThemeCard } from "./ThemeCard";

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

/** Admin "Server" page: announcement, live metrics, services, new accounts and theme. */
export function ServerPage({ settings, snapshot }: { settings: ServerSettings; snapshot: ServerSnapshot }) {
  usePageTitle("Server");
  const router = useRouter();
  const { notify } = useShell();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const message = await action();
      if (message) notify(message);
      router.refresh();
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <AnnouncementCard
        key={settings.announcement?.id ?? "none"}
        announcement={settings.announcement}
        busy={busy}
        notify={notify}
        onPublish={(text, level) =>
          void run(async () => {
            await settingsApi.publish(text, level);
            return "Announcement published";
          })
        }
        onTakeDown={() =>
          void run(async () => {
            await settingsApi.takeDown();
            return "Announcement removed";
          })
        }
      />
      <ServerMetrics initial={snapshot} />
      <SignupCard
        mode={settings.signupMode}
        invites={settings.invites}
        busy={busy}
        onMode={(mode) =>
          void run(async () => {
            await settingsApi.signupMode(mode);
            return null;
          })
        }
        onGenerate={() =>
          void run(async () => {
            await settingsApi.newInvite();
            return null;
          })
        }
        onCopy={(code) => {
          navigator.clipboard?.writeText(code).catch(() => undefined);
          notify("Code copied");
        }}
        onRevoke={(code) =>
          void run(async () => {
            await settingsApi.revokeInvite(code);
            return null;
          })
        }
      />
      <ThemeCard
        theme={settings.theme}
        busy={busy}
        onTheme={(theme) =>
          void run(async () => {
            await settingsApi.theme(theme);
            return "Theme changed";
          })
        }
      />
    </div>
  );
}
