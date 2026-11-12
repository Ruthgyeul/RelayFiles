"use client";

import { useState } from "react";
import { formatShortDate } from "@/domain/format";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { profileApi } from "./api";
import { SectionTitle } from "./Section";

/** "Export account": the whole account as one .tar the browser downloads. */
export function ExportCard({ deletesAt, notify }: { deletesAt: string | null; notify: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      // Confirms a recent sign-in (the dialog opens when needed) before the download starts.
      await profileApi.checkExport();
      window.location.assign(profileApi.exportUrl);
      notify("Your export is downloading");
    } catch (caught) {
      notify(caught instanceof ApiClientError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Export account" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <SectionTitle icon="package" box="bg-accent-soft" color="text-accent-icon">
        <h2 className="m-0 text-[17px] font-bold">Export account</h2>
      </SectionTitle>
      <p className="m-0 text-[13px] text-pretty text-t2">
        Download every file and folder as one .tar, with a manifest of tags, notes and favorites. Share links and passwords aren&apos;t included.
        {deletesAt && ` This account is deleted on ${formatShortDate(deletesAt)}: download everything before then.`}
      </p>
      <div>
        <Button size={34} icon="download-simple" disabled={busy} onClick={() => void start()}>
          Download everything
        </Button>
      </div>
    </section>
  );
}
