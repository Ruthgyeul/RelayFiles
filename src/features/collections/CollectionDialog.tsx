"use client";

import { useState } from "react";
import { SHARE } from "@/config/policy";
import type { CollectionDto } from "@/contracts/collections";
import { EXPIRY_OPTIONS, isExpiryOption } from "@/domain/share";
import { errorMessage } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { Field, FieldGroup, TextArea, TextInput } from "@/shared/ui/Field";
import { Modal, ModalFooter, ModalHeader } from "@/shared/ui/Modal";
import { CheckRow, OptionChip } from "@/shared/ui/Option";
import { collectionsApi } from "./api";

/** A new collection of the selected items, or one to change. */
export type CollectionRequest = { kind: "create"; nodeIds: string[]; name: string } | { kind: "edit"; collection: CollectionDto };

interface CollectionDialogProps {
  request: CollectionRequest;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (collection: CollectionDto) => void;
}

/** The dialog is remounted per request (key), so the draft starts from it. */
function initialDraft(request: CollectionRequest) {
  const current = request.kind === "edit" ? request.collection : null;
  return {
    name: current?.name ?? (request.kind === "create" ? request.name : ""),
    expiry: current && isExpiryOption(current.expiry) ? current.expiry : "Never",
    burn: current?.burn ?? false,
    limit: current?.downloadLimit ? String(current.downloadLimit) : "",
    password: "",
    clearPassword: false,
    access: current?.access ?? "both",
    note: current?.note ?? "",
  };
}

/**
 * "Share as collection" and a collection's settings (480px, like the item settings dialog):
 * name, expiry (admins), limits, password, access and the note on its share page.
 */
export function CollectionDialog({ request, isAdmin, onClose, onSaved }: CollectionDialogProps) {
  const [draft, setDraft] = useState(() => initialDraft(request));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  const editing = request.kind === "edit" ? request.collection : null;
  const name = draft.name.trim();

  const save = async () => {
    if (!name) return setError("Give the collection a name.");
    setBusy(true);
    setError("");
    const settings = {
      name,
      note: draft.note,
      downloadLimit: draft.limit ? Number(draft.limit) : null,
      access: draft.access,
      ...(isAdmin ? { expiry: draft.expiry, burn: draft.burn } : {}),
    };
    const password = draft.password ? draft.password : draft.clearPassword ? "" : undefined;
    try {
      const saved =
        request.kind === "create"
          ? await collectionsApi.create({ ...settings, nodeIds: request.nodeIds, ...(password ? { password } : {}) })
          : await collectionsApi.update(request.collection.id, { ...settings, ...(password !== undefined ? { password } : {}) });
      onSaved(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const count = request.kind === "create" ? request.nodeIds.length : request.collection.items.length;
  return (
    <Modal open onClose={onClose} width={480} layer="modal">
      <ModalHeader title={editing ? `Collection settings · ${editing.name}` : "Share as collection"} subtitle={`${count} ${count === 1 ? "item" : "items"} · one link`} icon="stack" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <Field label="Name (shown on the share page)">
          <TextInput value={draft.name} maxLength={SHARE.collectionNameMax} onChange={(event) => set({ name: event.target.value })} autoFocus />
        </Field>
        {isAdmin && (
          <>
            <FieldGroup label="Link expires after">
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY_OPTIONS.map((option) => (
                  <OptionChip key={option} selected={draft.expiry === option} onClick={() => set({ expiry: option })}>
                    {option}
                  </OptionChip>
                ))}
              </div>
            </FieldGroup>
            <CheckRow checked={draft.burn} onCheckedChange={(burn) => set({ burn })}>
              Close the link after the first download
            </CheckRow>
          </>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
          <Field label="Max downloads">
            <TextInput value={draft.limit} onChange={(event) => set({ limit: event.target.value.replace(/\D/g, "") })} placeholder="Unlimited" inputMode="numeric" />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              value={draft.password}
              onChange={(event) => set({ password: event.target.value, clearPassword: false })}
              placeholder={editing?.hasPassword && !draft.clearPassword ? "Set · type to change" : "None"}
              autoComplete="new-password"
            />
            {editing?.hasPassword && !draft.clearPassword && !draft.password && (
              <button type="button" onClick={() => set({ clearPassword: true })} className="self-start border-0 bg-transparent p-0 text-[12px] font-semibold text-accent-icon">
                Remove password
              </button>
            )}
          </Field>
        </div>
        <FieldGroup label="Access">
          <div className="flex flex-wrap gap-1.5">
            <OptionChip selected={draft.access === "both"} onClick={() => set({ access: "both" })}>
              Download + stream
            </OptionChip>
            <OptionChip selected={draft.access === "stream"} onClick={() => set({ access: "stream" })}>
              Stream only
            </OptionChip>
          </div>
        </FieldGroup>
        <Field label="Note (shown on the share page)">
          <TextArea rows={3} value={draft.note} onChange={(event) => set({ note: event.target.value })} />
        </Field>
        <span className="text-[12px] text-pretty text-t4">Anyone with the link sees these items, even private ones. Items behind a password of their own are left out.</span>
        {error && <span className="text-[13px] text-danger-text">{error}</span>}
      </div>
      <ModalFooter>
        <Button size={36} onClick={onClose} className="px-4 text-[14px]">
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={busy} onClick={() => void save()} className="px-4 text-[14px]">
          {editing ? "Save" : "Create link"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
