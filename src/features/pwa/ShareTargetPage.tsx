"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatSize } from "@/domain/format";
import { SHARE_PROBLEM_TEXT, sharedTotals, type ShareProblem, type ShareTargetState } from "@/domain/share-target";
import { useShell } from "@/features/shell/ShellProvider";
import { entriesFromList } from "@/features/transfers/read-drop";
import { HOME_TARGET, useTransfers } from "@/features/transfers/transfers-context";
import { folderHref } from "@/shared/lib/routes";
import { Button } from "@/shared/ui/Button";
import { ButtonLink } from "@/shared/ui/ButtonLink";
import { Icon } from "@/shared/ui/icon/Icon";
import { StateCard } from "@/shared/ui/StateCard";
import { claimSharedFiles } from "./share-handoff";

type View = { kind: "loading" } | { kind: "files"; files: File[] } | { kind: "problem"; problem: ShareProblem };

function ProblemCard({ problem }: { problem: ShareProblem }) {
  const text = SHARE_PROBLEM_TEXT[problem];
  return (
    <StateCard icon="warning-circle" iconBox="bg-btn" iconColor="text-t3" title={text.title}>
      <p className="m-0 text-[14px] leading-[1.5] text-pretty text-t3">{text.body}</p>
      <ButtonLink href="/" variant="primary" icon="house">
        Go to Home
      </ButtonLink>
    </StateCard>
  );
}

/**
 * The files are uploaded only after a tap: the service worker also catches a share post that
 * another site's form sent, and those files must never land in the Home of whoever is signed in.
 */
function SharedFilesCard({ files }: { files: File[] }) {
  const router = useRouter();
  const { activeAccount, openSignIn } = useShell();
  const { upload } = useTransfers();
  const [busy, setBusy] = useState(false);
  const { count, bytes } = sharedTotals(files);

  const start = () => {
    setBusy(true);
    // The upload continues in the transfers panel while the File Manager shows the new folder.
    // A refused batch (quota, size, item limit) is reported by a toast; the files stay here.
    upload(entriesFromList(files), HOME_TARGET, { onStart: (folder) => router.replace(folderHref(folder.id)), onRefused: () => setBusy(false) });
  };

  return (
    <section aria-label="Upload shared files" className="overflow-hidden rounded-2xl border border-card-line bg-card">
      <div className="flex items-center gap-3 border-b border-card-line px-5 py-[18px]">
        <span className="flex size-10 items-center justify-center rounded-[10px] bg-accent-soft">
          <Icon name="share-network" size={22} className="text-accent-icon" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 text-[18px] font-bold">Upload shared files</h1>
          <span className="text-[13px] text-t4">
            {count} {count === 1 ? "file" : "files"} · {formatSize(bytes)} · they go to a new folder in Home
          </span>
        </div>
      </div>
      <ul aria-label="Shared files" className="m-0 flex max-h-[320px] list-none flex-col gap-px overflow-y-auto bg-card-line p-0">
        {files.map((file, index) => (
          <li key={`${index}-${file.name}`} className="flex items-center gap-2.5 bg-card px-5 py-2.5 text-[14px]">
            <Icon name="file" size={18} className="shrink-0 text-t4" />
            <span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span>
            <span className="shrink-0 text-[13px] text-t4">{formatSize(file.size)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-card-line px-5 py-3.5">
        {activeAccount ? <span className="mr-auto text-[13px] text-t4">Uploading as {activeAccount.name}</span> : <span className="mr-auto text-[13px] text-t4">Sign in to upload these files</span>}
        <Button variant="secondary" size={38} hoverable onClick={() => router.replace("/")}>
          Cancel
        </Button>
        {activeAccount ? (
          <Button variant="primary" size={38} icon="upload-simple" hoverable disabled={busy || count === 0} onClick={start}>
            Upload to Home
          </Button>
        ) : (
          <Button variant="primary" size={38} icon="sign-in" hoverable onClick={openSignIn}>
            Sign in
          </Button>
        )}
      </div>
    </section>
  );
}

/** /share-target: the files another app shared, handed over by the service worker. */
export function ShareTargetPage({ state }: { state: ShareTargetState }) {
  const [view, setView] = useState<View>(state.kind === "claim" ? { kind: "loading" } : state);
  const claimId = state.kind === "claim" ? state.id : null;
  // The worker hands the files out once: a second effect run (Strict Mode, or the refresh after
  // signing in) must reuse the first answer instead of asking again and getting nothing.
  const claim = useRef<{ id: string; files: Promise<File[] | null> } | null>(null);

  useEffect(() => {
    if (!claimId) return;
    if (claim.current?.id !== claimId) claim.current = { id: claimId, files: claimSharedFiles(claimId).catch(() => null) };
    let cancelled = false;
    void claim.current.files.then((files) => {
      if (!cancelled) setView(files && files.length > 0 ? { kind: "files", files } : { kind: "problem", problem: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  if (view.kind === "problem") return <ProblemCard problem={view.problem} />;
  if (view.kind === "loading") {
    return (
      <p role="status" className="m-0 flex items-center justify-center gap-2 py-10 text-[14px] text-t3">
        <Icon name="circle-notch" size={18} className="animate-spin" />
        Getting the shared files
      </p>
    );
  }
  return <SharedFilesCard files={view.files} />;
}
