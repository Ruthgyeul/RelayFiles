"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal } from "@/shared/ui/Modal";
import { CheckRow } from "@/shared/ui/Option";

export interface NewTokenDialogProps {
  /** Account whose token is shown; null closes the dialog. */
  account: { id: string; name: string; token: string } | null;
  /** Called after "Continue" (only possible once the user confirmed saving the token). */
  onDone: () => void;
  /** Called after the token was copied (the caller shows the "Token copied" toast). */
  onCopied?: () => void;
}

/** Text file offered by "Save .txt" (same content as the design). */
export function tokenFileContent(account: { id: string; name: string; token: string }): string {
  return `RelayFiles account\nname: ${account.name}\nid: ${account.id}\ntoken: ${account.token}\n`;
}

function saveTextFile(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Save your account token" dialog. It cannot be dismissed by the backdrop or Escape;
 * Continue stays disabled until the user confirms the token is saved.
 */
export function NewTokenDialog({ account, onDone, onCopied }: NewTokenDialogProps) {
  const [saved, setSaved] = useState(false);
  const open = account !== null;

  const finish = () => {
    if (!saved) return;
    setSaved(false);
    onDone();
  };

  return (
    <Modal open={open} onClose={finish} width={460} layer="token" backdrop="strong" dismissible={false} label="Save your account token">
      {account && (
        <>
          <div className="flex flex-col items-center gap-2.5 px-5 pt-[22px] text-center">
            <span className="flex size-[52px] items-center justify-center rounded-[14px] bg-warn-bg-soft">
              <Icon name="key" weight="fill" size={26} className="text-warn-strong" />
            </span>
            <span className="text-[19px] font-bold">Save your account token</span>
            <span className="text-[14px] leading-[1.5] text-pretty text-t2">This is the only way to sign back in. It will not be shown in full again unless you&apos;re signed in.</span>
          </div>
          <div className="flex flex-col gap-3 px-5 py-[18px]">
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-[13px]">
              <dt className="text-t4">Name</dt>
              <dd className="m-0 font-mono">{account.name}</dd>
              <dt className="text-t4">ID</dt>
              <dd className="m-0 font-mono">{account.id}</dd>
            </dl>
            <div data-testid="new-token" className="rounded-[10px] border border-ctrl bg-bg p-3 font-mono text-[14px] leading-[1.5] break-all text-warn-pale">
              {account.token}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size={40}
                icon="copy"
                onClick={() => {
                  navigator.clipboard?.writeText(account.token).catch(() => undefined);
                  onCopied?.();
                }}
              >
                Copy
              </Button>
              <Button size={40} icon="download-simple" onClick={() => saveTextFile(`relay-${account.name}-token.txt`, tokenFileContent(account))}>
                Save .txt
              </Button>
            </div>
            <div className="flex gap-2.5 rounded-xl border border-danger-line bg-danger-bg px-3.5 py-3 text-[13px] leading-[1.5] text-pretty text-danger-pale">
              <Icon name="warning" weight="fill" size={18} className="mt-px text-danger-icon" />
              <span>Lose this token and the account and every file in it are gone for good. Nobody, including the server admin, can recover it.</span>
            </div>
            <CheckRow checked={saved} onCheckedChange={setSaved} className="py-1">
              I&apos;ve saved my token somewhere safe
            </CheckRow>
            <button
              type="button"
              onClick={finish}
              aria-disabled={!saved}
              className={cn("h-11 rounded-[10px] border-0 text-[15px] font-bold", saved ? "bg-accent text-on-accent" : "bg-confirm-disabled text-t5")}
            >
              Continue
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
