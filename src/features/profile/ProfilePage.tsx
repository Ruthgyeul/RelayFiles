"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import type { DeviceDto, ProfileData } from "@/contracts/profile";
import { usePageTitle } from "@/features/shell/page-title";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError } from "@/shared/lib/api-client";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { AccessCard } from "./AccessCard";
import { profileApi } from "./api";
import { DevicesCard } from "./DevicesCard";
import { DeleteAccountCard, PreferencesCard } from "./PreferencesCard";
import { ProfileCard } from "./ProfileCard";
import { UsageCards } from "./UsageCards";

type Confirm = { kind: "token" } | { kind: "others" } | { kind: "delete" } | null;

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

/** My Profile (`/settings`): profile, usage, access, devices, preferences and account deletion. */
export function ProfilePage({ data }: { data: ProfileData }) {
  usePageTitle("My Profile");
  const router = useRouter();
  const { notify, showNewToken, applySession } = useShell();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  /** Runs a change, shows its message and re-renders the page with fresh server data. */
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
      setConfirm(null);
    }
  };

  const signOutDevice = (device: DeviceDto) =>
    void run(async () => {
      await profileApi.signOutDevice(device.id);
      return `Signed out ${device.os}`;
    });

  const confirmed = () => {
    if (confirm?.kind === "token")
      void run(async () => {
        const { token, account } = await profileApi.newToken();
        showNewToken({ id: account.id, name: account.name, token });
        return null;
      });
    if (confirm?.kind === "others")
      void run(async () => {
        await profileApi.signOutOthers();
        return "Other devices signed out";
      });
    if (confirm?.kind === "delete")
      void run(async () => {
        const session = await profileApi.deleteAccount();
        router.push("/" as Route);
        applySession(session);
        return "Account deleted";
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <ProfileCard account={data.account} />
      <UsageCards data={data} />
      <AccessCard key={data.maskedToken} accountId={data.account.id} maskedToken={data.maskedToken} notify={notify} onRegenerate={() => setConfirm({ kind: "token" })} />
      <DevicesCard devices={data.devices} onSignOut={signOutDevice} onSignOutOthers={() => setConfirm({ kind: "others" })} />
      <PreferencesCard
        busy={busy}
        stripMetadata={data.account.stripMetadataOnShare}
        onStripMetadata={(on) =>
          void run(async () => {
            await profileApi.savePreferences({ stripMetadataOnShare: on });
            return on ? "Metadata is removed from public photos" : "Public photos keep their metadata";
          })
        }
        onPurge={() =>
          void run(async () => {
            const { deleted } = await profileApi.purgeExpired();
            return deleted === 0 ? "No expired folders" : `${deleted} expired ${deleted === 1 ? "item" : "items"} deleted`;
          })
        }
      />
      <DeleteAccountCard onDelete={() => setConfirm({ kind: "delete" })} />

      <ConfirmDialog
        open={confirm?.kind === "token"}
        tone="accent"
        icon="arrows-clockwise"
        title="Generate a new token?"
        description="The current token stops working on every device immediately."
        confirmLabel="Generate"
        busy={busy}
        onConfirm={confirmed}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "others"}
        icon="sign-out"
        title="Sign out every other device?"
        confirmLabel="Sign out"
        busy={busy}
        onConfirm={confirmed}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "delete"}
        title="Delete this account?"
        description="The account and all its files are deleted permanently. This can't be undone."
        confirmLabel="Delete account"
        busy={busy}
        onConfirm={confirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
