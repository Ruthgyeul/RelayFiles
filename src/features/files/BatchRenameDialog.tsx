"use client";

import { useState } from "react";
import { DEFAULT_PATTERN, planBatchRename, renameChanges, type NameCase, type RenameItem, type RenamePattern } from "@/domain/batch-rename";
import { formatCount } from "@/domain/format";
import { ApiClientError } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/cn";
import { filesApi } from "@/shared/lib/files-api";
import { Button } from "@/shared/ui/Button";
import { Field, FieldGroup, TextInput } from "@/shared/ui/Field";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalHeader } from "@/shared/ui/Modal";
import { CheckRow, OptionChip } from "@/shared/ui/Option";

export interface BatchRenameRequest {
  /** The selected items, in the order they are listed. */
  items: RenameItem[];
  /** Names in the folder that are not selected, or null when unknown (tag search results). */
  others: string[] | null;
}

const CASES: { key: NameCase; label: string }[] = [
  { key: "keep", label: "Keep" },
  { key: "lower", label: "lowercase" },
  { key: "upper", label: "UPPERCASE" },
];
const MAX_DIGITS = 6;
const items = (count: number) => `${formatCount(count)} ${count === 1 ? "item" : "items"}`;
const whole = (text: string, fallback: number) => (/^\d+$/.test(text) ? Number(text) : fallback);

/**
 * "Rename" for several items of one folder: find and replace, a prefix and suffix with `{n}`
 * numbers, and letter case, with every new name shown (and checked) before anything changes.
 */
export function BatchRenameDialog({ request, onClose, onDone }: { request: BatchRenameRequest | null; onClose: () => void; onDone: (message: string) => void }) {
  const [pattern, setPattern] = useState<RenamePattern>(DEFAULT_PATTERN);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (changes: Partial<RenamePattern>) => (setError(""), setPattern((current) => ({ ...current, ...changes })));
  const rows = request ? planBatchRename(request.items, pattern, request.others) : [];
  const changes = renameChanges(rows);
  const blocked = rows.some((row) => row.error !== null);

  const close = () => {
    setPattern(DEFAULT_PATTERN);
    setError("");
    onClose();
  };
  const submit = async () => {
    if (blocked || changes.length === 0 || busy) return;
    setBusy(true);
    try {
      const { renamed } = await filesApi.renameBatch(changes);
      onDone(`Renamed ${items(renamed)}`);
      close();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={request !== null} onClose={close} width={560} layer="subdialog" className="overflow-hidden">
      <ModalHeader title="Rename items" subtitle={request ? items(request.items.length) : undefined} icon="pencil-simple" onClose={close} closeSize={36} />
      <div className="flex shrink-0 flex-col gap-3 overflow-auto border-b border-card-line px-5 py-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Field label="Find">
            <TextInput value={pattern.find} onChange={(event) => set({ find: event.target.value })} spellCheck={false} />
          </Field>
          <Field label="Replace with">
            <TextInput value={pattern.replace} onChange={(event) => set({ replace: event.target.value })} spellCheck={false} />
          </Field>
          <Field label="Add before">
            <TextInput value={pattern.prefix} onChange={(event) => set({ prefix: event.target.value })} spellCheck={false} />
          </Field>
          <Field label="Add after">
            <TextInput value={pattern.suffix} onChange={(event) => set({ suffix: event.target.value })} spellCheck={false} />
          </Field>
          <Field label="Start number">
            <TextInput inputMode="numeric" value={String(pattern.start)} onChange={(event) => set({ start: whole(event.target.value, 0) })} />
          </Field>
          <Field label="Digits">
            <TextInput inputMode="numeric" value={String(pattern.digits)} onChange={(event) => set({ digits: Math.min(MAX_DIGITS, Math.max(1, whole(event.target.value, 1))) })} />
          </Field>
        </div>
        <span className="text-[12px] text-t4">Type {"{n}"} in a field to number the items in the order they are listed.</span>
        <FieldGroup label="Letter case">
          <div className="flex flex-wrap gap-2">
            {CASES.map((entry) => (
              <OptionChip key={entry.key} selected={pattern.nameCase === entry.key} onClick={() => set({ nameCase: entry.key })}>
                {entry.label}
              </OptionChip>
            ))}
          </div>
        </FieldGroup>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <CheckRow checked={pattern.matchCase} onCheckedChange={(matchCase) => set({ matchCase })}>
            Match case
          </CheckRow>
          <CheckRow checked={pattern.keepExtension} onCheckedChange={(keepExtension) => set({ keepExtension })}>
            Keep extensions
          </CheckRow>
        </div>
      </div>
      <ol className="m-0 max-h-[36vh] min-h-[100px] flex-1 list-none overflow-auto p-2" aria-label="New names">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col rounded-lg px-3 py-1.5 text-[13px] [content-visibility:auto]">
            <span className="flex min-h-6 items-center gap-2">
              <span className={cn("min-w-0 flex-1 truncate", row.from === row.to ? "text-t4" : "text-t2")} title={row.from}>
                {row.from}
              </span>
              <Icon name="arrow-right" size={14} className="shrink-0 text-t4" />
              <span className={cn("max-w-[50%] shrink-0 truncate", row.error ? "text-danger-text" : row.from === row.to ? "text-t4" : "font-semibold text-t1")} title={row.to}>
                {row.to}
              </span>
            </span>
            {row.error && <span className="text-[12px] text-danger-text">{row.error}</span>}
          </li>
        ))}
      </ol>
      {error && <p className="m-0 px-5 pb-2 text-[13px] text-danger-text">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-card-line px-5 py-3">
        <span className="min-w-[120px] flex-1 text-[13px] text-t3">{blocked ? "Fix the names marked in red." : `${items(changes.length)} will be renamed`}</span>
        <Button size={38} onClick={close}>
          Cancel
        </Button>
        <Button size={38} variant="primary" disabled={blocked || changes.length === 0 || busy} onClick={() => void submit()}>
          {changes.length > 0 ? `Rename ${items(changes.length)}` : "Rename"}
        </Button>
      </div>
    </Modal>
  );
}
