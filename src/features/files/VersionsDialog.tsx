"use client";

import { useEffect, useState } from "react";
import type { FileVersionDto } from "@/contracts/nodes";
import { formatDateTime, formatSize } from "@/domain/format";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError } from "@/shared/lib/api-client";
import { fileUrls, filesApi } from "@/shared/lib/files-api";
import { Button, buttonClassName } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { Modal, ModalHeader } from "@/shared/ui/Modal";

export interface VersionsRequest {
  nodeId: string;
  name: string;
}

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

/**
 * "Version history": the earlier versions an upload replaced, newest first. Each can be downloaded,
 * restored (the current file becomes a version, so nothing is lost) or deleted for good.
 */
export function VersionsDialog({ request, onClose, onDone }: { request: VersionsRequest | null; onClose: () => void; onDone: (message: string) => void }) {
  const { config } = useShell();
  const [loaded, setLoaded] = useState<{ nodeId: string; versions: FileVersionDto[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const versions = loaded && loaded.nodeId === request?.nodeId ? loaded.versions : null;

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    filesApi
      .versions(request.nodeId)
      .then((list) => !cancelled && setLoaded({ nodeId: request.nodeId, versions: list }))
      .catch((caught: unknown) => !cancelled && setError(errorText(caught)));
    return () => {
      cancelled = true;
    };
  }, [request]);

  const close = () => {
    setLoaded(null);
    setError("");
    setConfirm(null);
    onClose();
  };
  const act = async (versionId: string, action: "restore" | "delete") => {
    if (!request || busy) return;
    setBusy(versionId);
    setError("");
    try {
      if (action === "restore") {
        await filesApi.restoreVersion(request.nodeId, versionId);
        onDone(`Restored an earlier version of ${request.name}`);
        close();
      } else {
        await filesApi.deleteVersion(request.nodeId, versionId);
        setLoaded((current) => (current ? { ...current, versions: current.versions.filter((version) => version.id !== versionId) } : current));
        setConfirm(null);
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={request !== null} onClose={close} width={520} layer="subdialog" className="overflow-hidden">
      <ModalHeader title="Version history" subtitle={request?.name} icon="clock-counter-clockwise" onClose={close} closeSize={36} />
      <p className="m-0 border-b border-card-line px-5 py-3 text-[13px] text-pretty text-t3">
        {config.fileVersionsDays > 0
          ? `When an upload replaces this file, the previous one is kept here for ${days(config.fileVersionsDays)}. Kept versions count toward your storage.`
          : "This server keeps no earlier versions of replaced files."}
      </p>
      <ol className="m-0 max-h-[50vh] min-h-[100px] flex-1 list-none overflow-auto p-2" aria-label="Earlier versions" aria-busy={versions === null && !error}>
        {versions?.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-t4">No earlier versions.</li>}
        {versions?.map((version) => (
          <li key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5 text-[13px]">
            <div className="flex min-w-[160px] flex-1 flex-col gap-0.5">
              <span className="font-semibold text-t1">
                Replaced <LocalDate value={version.replacedAt} format={formatDateTime} />
              </span>
              <span className="text-[12px] text-t4">
                {formatSize(Number(version.size))} · removed <LocalDate value={version.expiresAt} format={formatDateTime} />
              </span>
            </div>
            {confirm === version.id ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[12px] text-t3">Delete for good?</span>
                <Button size={30} onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button size={30} variant="danger-solid" disabled={busy !== null} onClick={() => void act(version.id, "delete")}>
                  Delete
                </Button>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <a href={request ? fileUrls.versionContent(request.nodeId, version.id) : undefined} download className={buttonClassName({ size: 30 })} aria-label="Download this version">
                  <Icon name="download-simple" />
                </a>
                <Button size={30} icon="arrow-counter-clockwise" disabled={busy !== null} onClick={() => void act(version.id, "restore")}>
                  Restore
                </Button>
                <Button size={30} variant="ghost" icon="trash" aria-label="Delete this version" disabled={busy !== null} onClick={() => setConfirm(version.id)} />
              </span>
            )}
          </li>
        ))}
        {versions === null && !error && <li className="px-3 py-6 text-center text-[13px] text-t4">Loading…</li>}
      </ol>
      {error && <p className="m-0 px-5 pb-3 text-[13px] text-danger-text">{error}</p>}
    </Modal>
  );
}
