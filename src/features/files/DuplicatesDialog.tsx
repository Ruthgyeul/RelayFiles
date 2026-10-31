"use client";

import { useEffect, useMemo, useState } from "react";
import { FILES } from "@/config/policy";
import type { DuplicateFile, DuplicatesResult } from "@/contracts/nodes";
import { defaultDuplicateSelection, fullySelectedGroups } from "@/domain/duplicates";
import { formatCount, formatSize } from "@/domain/format";
import { ApiClientError } from "@/shared/lib/api-client";
import { filesApi } from "@/shared/lib/files-api";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/Display";
import { Modal, ModalHeader } from "@/shared/ui/Modal";
import { CheckRow } from "@/shared/ui/Option";
import { DuplicateGroupCard } from "./DuplicateGroupCard";

export interface DuplicatesRequest {
  folderId: string;
  name: string;
}

const errorOf = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");
const files = (count: number) => `${formatCount(count)} ${count === 1 ? "file" : "files"}`;
/** The groups as the selection helpers read them (sizes as numbers). */
const asCandidates = (result: DuplicatesResult) =>
  result.groups.map((group) => ({ ...group, size: Number(group.size), wasted: Number(group.wasted), files: group.files.map((file) => ({ ...file, sha256: group.sha256, size: Number(group.size), createdAt: Date.parse(file.createdAt) })) }));

/** Scan result line: "120 files compared · 3 not checked". */
function scanText(result: DuplicatesResult): string {
  const parts = [`${files(result.scanned)} compared`];
  if (result.unchecked > 0) parts.push(`${formatCount(result.unchecked)} not checked (no content hash)`);
  if (result.truncated) parts.push("only part of the folder was scanned");
  return parts.join(" · ");
}

/**
 * "Find duplicates": files with the same content (not the same name) in a folder, optionally with
 * its subfolders. Every copy but the oldest starts selected; deleting uses the normal delete.
 */
export function DuplicatesDialog({ request, onClose, onDone, onReveal }: { request: DuplicatesRequest | null; onClose: () => void; onDone: (message: string) => void; onReveal: (file: DuplicateFile) => void }) {
  const [recursive, setRecursive] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; result: DuplicatesResult } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // A result belongs to one folder and scope; anything else shows as loading.
  const key = request ? `${request.folderId}:${recursive ? 1 : 0}` : "";
  const result = loaded?.key === key ? loaded.result : null;

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    filesApi
      .duplicates(request.folderId, recursive)
      .then((found) => {
        if (cancelled) return;
        setLoaded({ key, result: found });
        setSelected(new Set(defaultDuplicateSelection(asCandidates(found))));
      })
      .catch((caught: unknown) => !cancelled && setError(errorOf(caught)));
    return () => {
      cancelled = true;
    };
  }, [request, recursive, key]);

  const groups = useMemo(() => (result ? asCandidates(result) : []), [result]);
  const unsafe = fullySelectedGroups(groups, selected).length > 0;
  const freed = groups.reduce((sum, group) => sum + group.size * group.files.filter((file) => selected.has(file.id)).length, 0);

  const close = () => {
    setLoaded(null);
    setError("");
    setConfirming(false);
    onClose();
  };
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const remove = async () => {
    setBusy(true);
    try {
      const ids = [...selected];
      let deleted = 0;
      for (let start = 0; start < ids.length; start += FILES.maxBatchItems) deleted += (await filesApi.remove(ids.slice(start, start + FILES.maxBatchItems))).deleted;
      onDone(`Deleted ${files(deleted)}`);
      close();
    } catch (caught) {
      setConfirming(false);
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={request !== null && !confirming} onClose={close} width={600} layer="subdialog" className="overflow-hidden">
        <ModalHeader title="Find duplicates" subtitle={request?.name} icon="files" onClose={close} closeSize={36} />
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-card-line px-5 py-3">
          <CheckRow checked={recursive} onCheckedChange={setRecursive}>
            Include subfolders
          </CheckRow>
          <span className="text-[12px] text-t4">{result ? scanText(result) : "Comparing file contents…"}</span>
        </div>
        <div className="flex max-h-[50vh] min-h-[160px] flex-1 flex-col gap-2 overflow-auto p-3" aria-busy={result === null}>
          {result?.groups.length === 0 && <EmptyState icon="files" title="No duplicates found" description="No two files here have the same content." className="bg-transparent py-8" />}
          {result?.groups.map((group) => <DuplicateGroupCard key={group.sha256} group={group} selected={selected} onToggle={toggle} onReveal={(file) => (close(), onReveal(file))} />)}
        </div>
        {error && <p className="m-0 px-5 pb-2 text-[13px] text-danger-text">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-card-line px-5 py-3">
          <span className="min-w-[120px] flex-1 text-[13px] text-t3">{selected.size > 0 ? `${files(selected.size)} selected · ${formatSize(freed)}` : "Select copies to delete"}</span>
          <Button size={38} onClick={close}>
            Close
          </Button>
          <Button size={38} variant="danger-solid" disabled={selected.size === 0 || unsafe || busy} onClick={() => setConfirming(true)}>
            Delete selected
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirming}
        tone="danger"
        icon="trash"
        title={`Delete ${files(selected.size)}?`}
        description={`${formatSize(freed)} of copies will be permanently deleted; one copy of each file stays. Share links to the deleted copies stop working. Copies that share their bytes on disk free quota, not always disk space. This can't be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
