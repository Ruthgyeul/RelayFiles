"use client";

import { useState } from "react";
import { API } from "@/config/policy";
import { ADMIN_ONLY_SCOPES, API_SCOPE_LABEL, API_SCOPES, type ApiScope, type CreateApiTokenInput, type CreatedApiToken } from "@/contracts/api-tokens";
import { Button } from "@/shared/ui/Button";
import { Field, TextInput } from "@/shared/ui/Field";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/Modal";
import { CheckRow, OptionChip } from "@/shared/ui/Option";

const label = "text-[13px] font-semibold text-t3";
const note = "text-[12px] text-t4";

interface CreateApiTokenDialogProps {
  isAdmin: boolean;
  busy: boolean;
  /** Set once the server answered: the dialog then shows the token instead of the form. */
  created: CreatedApiToken | null;
  onCreate: (input: CreateApiTokenInput) => void;
  onCopy: (token: string) => void;
  onClose: () => void;
}

/** "New API token": name, scopes and lifetime; afterwards the token itself, shown this once. */
export function CreateApiTokenDialog({ isAdmin, busy, created, onCreate, onCopy, onClose }: CreateApiTokenDialogProps) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["files:read", "files:write"]);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(API.expiryDays[1]);
  const offered = API_SCOPES.filter((scope) => isAdmin || !ADMIN_ONLY_SCOPES.includes(scope));
  const toggle = (scope: ApiScope, on: boolean) => setScopes((current) => (on ? [...current, scope] : current.filter((held) => held !== scope)));
  const valid = name.trim().length > 0 && scopes.length > 0;

  if (created) {
    return (
      <Modal open onClose={onClose} width={480} dismissible={false} layer="token" backdrop="strong">
        <ModalHeader icon="key" title="Copy your API token" onClose={onClose} />
        <ModalBody>
          <div className="flex items-center gap-2 rounded-lg bg-sunk py-1 pr-1 pl-3">
            <span aria-label="New API token" className="min-w-0 flex-1 truncate font-mono text-[13px] text-t1">
              {created.token}
            </span>
            <Button size={32} icon="copy" onClick={() => onCopy(created.token)}>
              Copy
            </Button>
          </div>
          <span className="flex gap-2 text-[13px] text-pretty text-t3">
            <Icon name="warning" size={18} className="shrink-0 text-warn-strong" />
            This is the only time the token is shown. Store it in the app that will use it; if it is lost, revoke it and create another.
          </span>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" size={36} onClick={onClose} className="px-4 text-[14px]">
            Done
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} width={480}>
      <ModalHeader icon="plugs" title="New API token" onClose={onClose} />
      <ModalBody className="gap-[18px]">
        <Field label="Name">
          <TextInput autoFocus value={name} maxLength={API.nameMaxLength} placeholder="ShareX on my laptop" onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="flex flex-col gap-2.5">
          <span className={label}>Allowed</span>
          {offered.map((scope) => (
            <CheckRow key={scope} checked={scopes.includes(scope)} onCheckedChange={(on) => toggle(scope, on)} description={<span className="font-mono">{scope}</span>}>
              {API_SCOPE_LABEL[scope]}
            </CheckRow>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className={label}>Expires</span>
          <div className="flex flex-wrap gap-1.5">
            {API.expiryDays.map((days) => (
              <OptionChip key={days} selected={expiresInDays === days} onClick={() => setExpiresInDays(days)}>
                {days} days
              </OptionChip>
            ))}
            <OptionChip selected={expiresInDays === null} onClick={() => setExpiresInDays(null)}>
              Never
            </OptionChip>
          </div>
          <span className={note}>The token works only on /api/v1, never in the web app. Revoke it here at any time.</span>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size={36} onClick={onClose} className="px-4 text-[14px]">
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={busy || !valid} onClick={() => onCreate({ name: name.trim(), scopes, expiresInDays })} className="px-4 text-[14px]">
          Create token
        </Button>
      </ModalFooter>
    </Modal>
  );
}
