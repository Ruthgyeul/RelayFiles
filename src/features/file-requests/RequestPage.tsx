"use client";

import type { FileRequestView } from "@/contracts/file-requests";
import { Logo } from "@/shared/ui/Display";
import { PasswordCard } from "@/shared/ui/PasswordCard";
import { StateCard } from "@/shared/ui/StateCard";
import { requestApi } from "./api";
import { RequestUploader } from "./RequestUploader";

const description = "m-0 text-[14px] leading-[1.5] text-pretty text-t3";

/** Public upload link `/r/<id>`: a closed state, the password form, or the upload form. */
export function RequestPage({ view, chunkBytes }: { view: FileRequestView; chunkBytes: number }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-line bg-header px-5">
        <Logo size={28} withText className="text-[18px]" />
      </header>
      <main className="flex flex-1 flex-col">
        {view.status === "expired" && (
          <StateCard icon="hourglass-simple-low" iconBox="bg-warn-bg-soft" iconColor="text-warn-strong" title="This link has expired">
            <p className={description}>It no longer takes files. Ask {view.ownerName} for a new link.</p>
          </StateCard>
        )}
        {view.status === "full" && (
          <StateCard icon="tray-arrow-down" iconBox="bg-warn-bg-soft" iconColor="text-warn-strong" title="This link is full">
            <p className={description}>It received as many files as {view.ownerName} asked for.</p>
          </StateCard>
        )}
        {view.status === "locked" && <PasswordCard title="This upload link is password protected" description={`Enter the password ${view.ownerName} gave you to send files.`} onUnlock={(password) => requestApi.unlock(view.id, password)} />}
        {view.status === "open" && <RequestUploader view={view} chunkBytes={chunkBytes} />}
      </main>
    </div>
  );
}
