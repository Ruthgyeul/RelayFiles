"use client";

import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { CheckRow } from "@/shared/ui/Option";
import { SectionTitle } from "./Section";

const box = "flex flex-wrap items-center gap-3 rounded-xl border border-ctrl bg-elev p-4";

interface PreferencesCardProps {
  stripMetadata: boolean;
  onStripMetadata: (on: boolean) => void;
  onPurge: () => void;
  busy: boolean;
}

/** Preferences of this account: expired items cleanup and photo metadata on public links. */
export function PreferencesCard({ stripMetadata, onStripMetadata, onPurge, busy }: PreferencesCardProps) {
  return (
    <section aria-label="Preferences" className="flex flex-col gap-4 rounded-2xl border border-card-line bg-card p-5">
      <SectionTitle
        icon="sliders-horizontal"
        box="bg-cyan-bg"
        color="text-cyan"
        after={<span className="rounded-full border border-ctrl bg-elev px-2.5 py-1 text-[11px] font-bold tracking-[.04em] text-t3">THIS ACCOUNT</span>}
      >
        <h2 className="m-0 flex-1 text-[17px] font-bold">Preferences</h2>
      </SectionTitle>
      <div className={box}>
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-bold">
            <Icon name="broom" className="text-warn-orange" />
            Expired items
          </span>
          <span className="text-[12px] text-t4">Files and folders past their own expiry are deleted automatically. Run cleanup now to free space immediately.</span>
        </div>
        <Button size={36} disabled={busy} onClick={onPurge}>
          Purge now
        </Button>
      </div>
      <div className={box}>
        <CheckRow
          checked={stripMetadata}
          disabled={busy}
          onCheckedChange={onStripMetadata}
          description="Photos sent through public links lose their location and camera details. Your original files are never changed."
          className="flex-1"
        >
          Strip metadata on public links
        </CheckRow>
      </div>
    </section>
  );
}

/** Delete account card (design danger card). */
export function DeleteAccountCard({ onDelete }: { onDelete: () => void }) {
  return (
    <section aria-label="Delete account" className="flex flex-wrap items-center gap-3 rounded-2xl border border-danger-line bg-card p-5">
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className="font-bold text-danger-pale">Delete account</span>
        <span className="text-[12px] text-t4">Removes the account, its token and all of its files permanently.</span>
      </div>
      <Button variant="danger-outline" size={36} onClick={onDelete}>
        Delete account
      </Button>
    </section>
  );
}
