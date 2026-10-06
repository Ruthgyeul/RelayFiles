"use client";

import { useState } from "react";
import type { NodeItem, SettingsInput, Visibility } from "@/contracts/nodes";
import { EXPIRY_OPTIONS, isExpiryOption } from "@/domain/share";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { Field, FieldGroup, TextArea, TextInput } from "@/shared/ui/Field";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { Modal, ModalFooter, ModalHeader } from "@/shared/ui/Modal";
import { CheckRow, OptionCard, OptionChip } from "@/shared/ui/Option";
import { filesApi } from "./api";

export interface SettingsRequest {
  item: NodeItem;
  isRoot: boolean;
  /** Visibility the item would inherit from its parent. */
  parentVisibility: "private" | "public";
}

interface SettingsDialogProps {
  request: SettingsRequest | null;
  isAdmin: boolean;
  /** Account deletion date (members only), for the expiry note. */
  accountDeletesAt: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const VISIBILITY_OPTIONS: { key: Visibility; label: string; icon: IconName; description: (parent: string) => string }[] = [
  { key: "inherit", label: "Inherit", icon: "arrow-bend-left-up", description: (parent) => `Same as parent · now ${parent}` },
  { key: "private", label: "Private", icon: "lock-key", description: () => "Only you can open it" },
  { key: "public", label: "Public", icon: "globe-simple", description: () => "Anyone with the link" },
];

/** The dialog is remounted per item (key), so the draft starts from the item's settings. */
function initialDraft(item: NodeItem, isRoot: boolean) {
  const s = item.settings;
  return {
    visibility: isRoot && s.visibility === "inherit" ? ("private" as Visibility) : s.visibility,
    expiry: isExpiryOption(s.expiry) ? s.expiry : "Never",
    burn: s.burn,
    limit: s.downloadLimit ? String(s.downloadLimit) : "",
    password: "",
    clearPassword: false,
    access: s.access,
    note: s.note,
    applyDown: false,
  };
}

/** "Folder settings · …" / "File settings · …" (480px): visibility, expiry, limits, password, access, note. */
export function SettingsDialog({ request, isAdmin, accountDeletesAt, onClose, onSaved }: SettingsDialogProps) {
  const [draft, setDraft] = useState(() => (request ? initialDraft(request.item, request.isRoot) : null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!request || !draft) return null;
  const { item, isRoot, parentVisibility } = request;
  const folder = item.type === "folder";
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    setBusy(true);
    setError("");
    const input: SettingsInput = {
      visibility: draft.visibility,
      expiry: draft.expiry,
      burn: draft.burn,
      downloadLimit: draft.limit ? Number(draft.limit) : null,
      password: draft.password ? draft.password : draft.clearPassword ? "" : undefined,
      access: draft.access,
      note: draft.note,
      applyDown: folder && draft.applyDown,
    };
    try {
      await filesApi.saveSettings(item.id, input);
      onSaved(input.applyDown ? "Saved · applied to everything inside" : "Settings saved");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const deletesOn = accountDeletesAt ? new Date(accountDeletesAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <Modal open onClose={onClose} width={480} layer="modal">
      <ModalHeader title={`${folder ? "Folder" : "File"} settings · ${item.name}`} onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <span className="flex items-center gap-1.5 text-[13px] text-t4">
          <Icon name="info" />
          {folder ? "Applies to this folder. Files inside keep their own expiry." : "Applies to this file only."}
        </span>
        <FieldGroup label="Visibility">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            {VISIBILITY_OPTIONS.filter((option) => !(isRoot && option.key === "inherit")).map((option) => (
              <OptionCard key={option.key} selected={draft.visibility === option.key} icon={option.icon} description={option.description(parentVisibility)} onClick={() => set({ visibility: option.key })}>
                {option.label}
              </OptionCard>
            ))}
          </div>
        </FieldGroup>
        {folder && (
          <CheckRow checked={draft.applyDown} onCheckedChange={(applyDown) => set({ applyDown })} description="Resets their own visibility so everything inside follows this folder. Leave off to keep mixed settings.">
            Apply to all subfolders and files
          </CheckRow>
        )}
        {isAdmin ? (
          <>
            <FieldGroup label="Delete after">
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY_OPTIONS.map((option) => (
                  <OptionChip key={option} selected={draft.expiry === option} onClick={() => set({ expiry: option })}>
                    {option}
                  </OptionChip>
                ))}
              </div>
            </FieldGroup>
            <CheckRow checked={draft.burn} onCheckedChange={(burn) => set({ burn })}>
              Delete after the first download
            </CheckRow>
          </>
        ) : (
          <div className="flex gap-2.5 rounded-xl border border-ctrl bg-elev px-3.5 py-3 text-[13px] leading-[1.5] text-pretty text-t2">
            <Icon name="hourglass-medium" size={18} className="text-warn-strong" />
            <span>
              {deletesOn ? `Everything in this account is deleted with it on ${deletesOn}. ` : ""}Only the admin can set deletion schedules.
            </span>
          </div>
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
              placeholder={item.settings.hasPassword && !draft.clearPassword ? "Set · type to change" : "None"}
              autoComplete="new-password"
            />
            {item.settings.hasPassword && !draft.clearPassword && !draft.password && (
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
        {error && <span className="text-[13px] text-danger-text">{error}</span>}
      </div>
      <ModalFooter>
        <Button size={36} onClick={onClose} className="px-4 text-[14px]">
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={busy} onClick={() => void save()} className="px-4 text-[14px]">
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}
