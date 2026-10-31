"use client";

import { useEffect, useState } from "react";
import type { RenumberPreview } from "@/contracts/nodes";
import { formatCount } from "@/domain/format";
import type { RenumberOrder, RenumberSort } from "@/domain/renumber";
import { ApiClientError } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/cn";
import { filesApi } from "@/shared/lib/files-api";
import { Button } from "@/shared/ui/Button";
import { FieldGroup } from "@/shared/ui/Field";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalHeader } from "@/shared/ui/Modal";
import { OptionChip } from "@/shared/ui/Option";

export interface RenumberRequest {
  folderId: string;
  name: string;
}

const SORT_LABEL: Record<RenumberSort, string> = { name: "Name", created: "Date created", modified: "Date modified" };
const ORDER_LABEL: Record<RenumberSort, Record<RenumberOrder, string>> = {
  name: { asc: "A → Z", desc: "Z → A" },
  created: { asc: "Oldest first", desc: "Newest first" },
  modified: { asc: "Oldest first", desc: "Newest first" },
};
const files = (count: number) => `${formatCount(count)} ${count === 1 ? "file" : "files"}`;
const errorOf = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

/** Summary under the list: "12 files · 2 already numbered · 1 hidden kept". */
function summaryOf(preview: RenumberPreview): string {
  const parts = [files(preview.entries.length)];
  const unchanged = preview.entries.length - preview.changes;
  if (unchanged > 0) parts.push(`${formatCount(unchanged)} already numbered`);
  if (preview.skipped.length > 0) parts.push(`${formatCount(preview.skipped.length)} kept (hidden or missing)`);
  return parts.join(" · ");
}

/**
 * "Renumber files": renames the files directly in a folder to 01, 02, 03, … (extensions kept)
 * in the chosen order. Shows every new name before anything changes; folders keep their names.
 */
export function RenumberDialog({ request, onClose, onDone }: { request: RenumberRequest | null; onClose: () => void; onDone: (message: string) => void }) {
  const [sort, setSort] = useState<RenumberSort>("name");
  const [order, setOrder] = useState<RenumberOrder>("asc");
  const [loaded, setLoaded] = useState<{ key: string; preview: RenumberPreview } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  // A preview belongs to one folder, order and reload; anything else shows as loading.
  const key = request ? `${request.folderId}:${sort}:${order}:${reload}` : "";
  const preview = loaded?.key === key ? loaded.preview : null;

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    filesApi
      .renumberPreview(request.folderId, sort, order)
      .then((result) => !cancelled && setLoaded({ key, preview: result }))
      .catch((caught: unknown) => !cancelled && setError(errorOf(caught)));
    return () => {
      cancelled = true;
    };
  }, [request, sort, order, key]);

  const close = () => {
    setLoaded(null);
    setError("");
    onClose();
  };
  const choose = (next: { sort?: RenumberSort; order?: RenumberOrder }) => {
    setError("");
    if (next.sort) setSort(next.sort);
    if (next.order) setOrder(next.order);
  };
  const submit = async () => {
    if (!request || !preview || busy) return;
    setBusy(true);
    try {
      const result = await filesApi.renumber(request.folderId, sort, order, preview.entries.map(({ id, to }) => ({ id, to })));
      onDone(`Renumbered ${files(result.renamed)}`);
      close();
    } catch (caught) {
      // The folder changed since the preview: show the new plan with the reason.
      setError(errorOf(caught));
      setReload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const ready = preview !== null && preview.conflict === null && preview.changes > 0;
  return (
    <Modal open={request !== null} onClose={close} width={520} layer="subdialog" className="overflow-hidden">
      <ModalHeader title="Renumber files" subtitle={request?.name} icon="list-numbers" onClose={close} closeSize={36} />
      <div className="flex shrink-0 flex-col gap-3 border-b border-card-line px-5 py-4">
        <FieldGroup label="Order by">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SORT_LABEL) as RenumberSort[]).map((key) => (
              <OptionChip key={key} selected={sort === key} onClick={() => choose({ sort: key })}>
                {SORT_LABEL[key]}
              </OptionChip>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup label="Direction">
          <div className="flex flex-wrap gap-2">
            {(["asc", "desc"] as const).map((key) => (
              <OptionChip key={key} selected={order === key} onClick={() => choose({ order: key })}>
                {ORDER_LABEL[sort][key]}
              </OptionChip>
            ))}
          </div>
        </FieldGroup>
      </div>
      <ol className="m-0 max-h-[40vh] min-h-[120px] flex-1 list-none overflow-auto p-2" aria-label="New names" aria-busy={preview === null}>
        {preview?.entries.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-t4">No files to renumber in this folder.</li>}
        {preview?.entries.map((entry) => {
          const same = entry.from === entry.to;
          return (
            <li key={entry.id} className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-[13px] [content-visibility:auto]">
              <span className={cn("min-w-0 flex-1 truncate", same ? "text-t4" : "text-t2")} title={entry.from}>
                {entry.from}
              </span>
              <Icon name="arrow-right" size={14} className="shrink-0 text-t4" />
              <span className={cn("max-w-[45%] shrink-0 truncate font-mono", same ? "text-t4" : "font-semibold text-t1")}>{entry.to}</span>
            </li>
          );
        })}
      </ol>
      {(error || preview?.conflict) && <p className="m-0 px-5 pb-2 text-[13px] text-danger-text">{error || preview?.conflict}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-card-line px-5 py-3">
        <span className="min-w-[120px] flex-1 text-[13px] text-t3">{preview ? summaryOf(preview) : "Loading…"}</span>
        <Button size={38} onClick={close}>
          Cancel
        </Button>
        <Button size={38} variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
          {ready ? `Renumber ${files(preview.changes)}` : "Renumber"}
        </Button>
      </div>
    </Modal>
  );
}
