"use client";

import type { DeviceDto } from "@/contracts/profile";
import { deviceIcon } from "@/domain/device";
import { formatSeen } from "@/domain/format";
import { useMounted } from "@/shared/hooks/useMounted";
import { useNow } from "@/shared/hooks/useNow";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { SectionTitle } from "./Section";

/** Re-render interval for "12m ago". */
const SEEN_TICK_MS = 60_000;

interface DevicesCardProps {
  devices: DeviceDto[];
  onSignOut: (device: DeviceDto) => void;
  onSignOutOthers: () => void;
}

/** "Signed-in devices" with this device first (design). */
export function DevicesCard({ devices, onSignOut, onSignOutOthers }: DevicesCardProps) {
  const now = useNow(true, SEEN_TICK_MS);
  const mounted = useMounted();
  const others = devices.some((device) => !device.current);
  return (
    <section aria-label="Signed-in devices" className="flex flex-col gap-1 rounded-2xl border border-card-line bg-card p-5">
      <div className="mb-2">
        <SectionTitle
          icon="devices"
          box="bg-accent-soft"
          color="text-accent-icon"
          after={
            others && (
              <Button variant="danger-outline" size={34} onClick={onSignOutOthers} className="px-3">
                Sign out all others
              </Button>
            )
          }
        >
          <div className="flex min-w-[160px] flex-1 flex-col gap-0.5">
            <h2 className="m-0 text-[17px] font-bold">Signed-in devices</h2>
            <span className="text-[12px] text-t4">
              {devices.length} {devices.length === 1 ? "device" : "devices"} signed in to this account
            </span>
          </div>
        </SectionTitle>
      </div>
      {devices.map((device) => (
        <div key={device.id} className="flex items-center gap-3 border-t border-card-line py-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-btn">
            <Icon name={deviceIcon(device.os)} size={18} className="text-t2" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[14px] font-bold">
              {device.os} · {device.browser}
              {device.current && <span className="rounded-full bg-ok-bg px-[7px] py-0.5 text-[10px] font-extrabold tracking-[.04em] text-ok-text">THIS DEVICE</span>}
            </span>
            <span className="truncate text-[12px] text-t4">
              {device.location} · {device.ipMasked} · {device.current ? "active now" : mounted ? formatSeen(Date.parse(device.lastSeenAt), now) : ""}
            </span>
          </div>
          {!device.current && (
            <Button size={32} onClick={() => onSignOut(device)}>
              Sign out
            </Button>
          )}
        </div>
      ))}
      <span className="mt-2 text-[12px] text-pretty text-t4">Don&apos;t recognize a device? Sign it out, then generate a new token from your profile so it can&apos;t sign back in.</span>
    </section>
  );
}
