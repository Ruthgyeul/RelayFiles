"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { DuplicatePolicy, PrepareUploadResult } from "@/contracts/uploads";
import { nameError } from "@/domain/names";
import { uploadFallbackName } from "@/domain/upload";
import { ApiClientError, apiFetch } from "@/shared/lib/api-client";
import { claimUpload } from "./api";
import type { DuplicateRequest } from "./DuplicateDialog";
import { uploadTransfer } from "./new-transfer";
import type { UploadEntry } from "./read-drop";
import type { UploadOptions, UploadTarget } from "./transfers-context";
import { BatchUploader } from "./upload-runner";
import type { TransferList } from "./useTransferList";

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

interface UploadSettings {
  notify: (message: string) => void;
  chunkBytes: number;
  /** The signed-in account, which a reload-interrupted upload is resumed for. */
  accountId: string | undefined;
}

/**
 * Uploads: skips names the file system cannot store, asks the server to prepare the batch (the
 * duplicate dialog when names are taken), then runs it with tus and shows it in the panel.
 */
export function useUploads({ add, fileEvents, finish, fail, update }: TransferList, { notify, chunkBytes, accountId }: UploadSettings) {
  const router = useRouter();
  const [lastUpload, setLastUpload] = useState<{ folderId: string; name: string } | null>(null);
  const [duplicate, setDuplicate] = useState<(DuplicateRequest & { entries: UploadEntry[]; target: UploadTarget; options?: UploadOptions }) | null>(null);

  const start = useCallback(
    (entries: UploadEntry[], target: UploadTarget, dup?: DuplicatePolicy, options?: UploadOptions) => {
      void (async () => {
        try {
          const plan = await apiFetch<PrepareUploadResult>("/api/uploads", {
            method: "POST",
            json: { target: target.ref, dup, files: entries.map((entry) => ({ rel: entry.rel, size: entry.file.size })), fallbackName: uploadFallbackName(new Date()) },
          });
          if (plan.kind === "duplicates") return setDuplicate({ names: plan.names, folderName: target.name, entries, target, options });
          if (plan.kind === "nothing") return notify("Nothing to upload · all files already exist");
          const files = plan.files.map((file) => entries[file.index]!.file);
          const transfer = uploadTransfer(plan, target);
          const id = transfer.id;
          const runner = new BatchUploader(
            plan,
            files,
            chunkBytes,
            {
              ...fileEvents(id),
              onProgress: (done) => update(id, () => ({ done })),
              onComplete: (failed, firstError) => {
                finish(id, failed, firstError);
                if (transfer.fromHome && failed < files.length) setLastUpload({ folderId: transfer.folderId, name: transfer.title });
                router.refresh();
              },
              onError: (message) => {
                fail(id, message);
                notify(message);
                router.refresh();
              },
            },
            // A file whose upload a reload interrupted continues where it stopped.
            { continueOnError: true, resume: accountId ? { scope: accountId, claim: claimUpload } : undefined },
          );
          add(transfer, runner);
          runner.start();
          options?.onStart?.({ id: plan.folder.id, name: plan.folder.name });
        } catch (caught) {
          notify(errorText(caught));
          options?.onRefused?.();
        }
      })();
    },
    [accountId, add, chunkBytes, fail, fileEvents, finish, notify, router, update],
  );

  const upload = useCallback(
    (entries: UploadEntry[], target: UploadTarget, options?: UploadOptions) => {
      // Names the file system can't store are skipped, like the design.
      const bad = entries.filter((entry) => entry.rel.split("/").some((part) => nameError(part)));
      if (bad.length) {
        const first = bad[0]!.rel.split("/").find((part) => nameError(part))!;
        notify(`${bad.length} ${bad.length === 1 ? "file" : "files"} skipped: ${nameError(first)}`);
      }
      const good = entries.filter((entry) => !bad.includes(entry));
      if (good.length) start(good, target, undefined, options);
      else options?.onRefused?.();
    },
    [notify, start],
  );

  /** Props of the "already exists" dialog for the batch waiting on it. */
  const duplicateDialog = {
    request: duplicate,
    onChoose: (policy: DuplicatePolicy) => duplicate && start(duplicate.entries, duplicate.target, policy, duplicate.options),
    onClose: () => setDuplicate(null),
  };

  return { upload, lastUpload, duplicateDialog };
}
