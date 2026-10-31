"use client";

import { useState } from "react";
import { FILE_REQUEST } from "@/config/policy";
import type { CreateFileRequestInput } from "@/contracts/file-requests";
import { Button } from "@/shared/ui/Button";
import { Field, TextInput } from "@/shared/ui/Field";
import { OptionChip } from "@/shared/ui/Option";

const label = "text-[13px] font-semibold text-t3";

/** A positive whole number typed into a limit field, or null when it is empty. */
const limitOf = (text: string) => (text === "" ? null : Math.max(1, parseInt(text, 10) || 1));

interface NewFileRequestFormProps {
  folderId: string;
  busy: boolean;
  onCreate: (input: CreateFileRequestInput) => void;
  onCancel: () => void;
}

/** Title, optional password, lifetime and limits of a new upload-only link. */
export function NewFileRequestForm({ folderId, busy, onCreate, onCancel }: NewFileRequestFormProps) {
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | null>(FILE_REQUEST.expiryDays[1]);
  const [maxFiles, setMaxFiles] = useState("");
  const [maxMb, setMaxMb] = useState("");
  const digits = (text: string) => text.replace(/[^0-9]/g, "");

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-ctrl bg-elev p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || busy) return;
        onCreate({ folderId, title: title.trim(), password: password || null, expiresInDays, maxFiles: limitOf(maxFiles), maxMb: limitOf(maxMb) });
      }}
    >
      <Field label="Title shown to uploaders">
        <TextInput autoFocus value={title} maxLength={FILE_REQUEST.titleMaxLength} placeholder="Photos from the trip" onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="Password (optional)">
        <TextInput type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field>
      <div className="flex flex-col gap-2">
        <span className={label}>Expires</span>
        <div className="flex flex-wrap gap-1.5">
          {FILE_REQUEST.expiryDays.map((days) => (
            <OptionChip key={days} selected={expiresInDays === days} onClick={() => setExpiresInDays(days)}>
              {days === 1 ? "1 day" : `${days} days`}
            </OptionChip>
          ))}
          <OptionChip selected={expiresInDays === null} onClick={() => setExpiresInDays(null)}>
            Never
          </OptionChip>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label="At most files" className="min-w-[120px] flex-1">
          <TextInput inputMode="numeric" placeholder="No limit" value={maxFiles} onChange={(event) => setMaxFiles(digits(event.target.value))} />
        </Field>
        <Field label="At most MB in total" className="min-w-[120px] flex-1">
          <TextInput inputMode="numeric" placeholder="No limit" value={maxMb} onChange={(event) => setMaxMb(digits(event.target.value))} />
        </Field>
      </div>
      <span className="text-[12px] text-pretty text-t4">Uploaders can only add files. They never see what is in this folder. Files count toward your storage.</span>
      <div className="flex justify-end gap-2">
        <Button size={36} onClick={onCancel} className="px-4 text-[14px]">
          Cancel
        </Button>
        <Button type="submit" variant="primary" size={36} disabled={busy || !title.trim()} className="px-4 text-[14px]">
          Create link
        </Button>
      </div>
    </form>
  );
}
