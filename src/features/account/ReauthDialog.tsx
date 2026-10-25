"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { setReauthHandler } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { TextInput } from "@/shared/ui/Field";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalBody, ModalHeader } from "@/shared/ui/Modal";
import { accountApi, type AccountApi } from "./api";

export interface ReauthDialogProps {
  open: boolean;
  onConfirmed: () => void;
  onCancel: () => void;
  api?: Pick<AccountApi, "reauthenticate">;
}

/** "Confirm it's you": an admin enters their token again before an account or token action. */
export function ReauthDialog({ open, onConfirmed, onCancel, api = accountApi }: ReauthDialogProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (confirmed: boolean) => {
    setToken("");
    setError("");
    if (confirmed) onConfirmed();
    else onCancel();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.reauthenticate(token.trim());
      close(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => close(false)} width={420} layer="subdialog">
      <ModalHeader title="Confirm it's you" titleSize={17} onClose={() => close(false)} />
      <ModalBody className="gap-3.5">
        <p className="m-0 text-[14px] leading-[1.5] text-pretty text-t2">This admin action needs your account token again.</p>
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5 text-[13px] font-bold text-t2">
            Account token
            <TextInput
              autoFocus
              height={44}
              surface="sunk"
              mono
              value={token}
              onChange={(event) => {
                setToken(event.target.value.trim());
                setError("");
              }}
              placeholder="40-character token"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
            />
          </label>
          {error && (
            <span role="alert" className="flex items-center gap-1.5 text-[13px] text-danger-text">
              <Icon name="warning-circle" />
              {error}
            </span>
          )}
          <Button type="submit" variant="primary" size={44} icon="key" iconSize={18} hoverable disabled={busy || token === ""} className="gap-2 border-0">
            Confirm
          </Button>
        </form>
      </ModalBody>
    </Modal>
  );
}

/**
 * Answers REAUTH_REQUIRED for the whole app: opens the dialog once (calls that need it at the
 * same time wait for the same answer) and lets `apiFetch` send the call again.
 */
export function ReauthGate() {
  const [pending, setPending] = useState<((confirmed: boolean) => void) | null>(null);
  const waiting = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    setReauthHandler(() => {
      waiting.current ??= new Promise<boolean>((resolve) => {
        setPending(() => (confirmed: boolean) => {
          waiting.current = null;
          setPending(null);
          resolve(confirmed);
        });
      });
      return waiting.current;
    });
    return () => setReauthHandler(null);
  }, []);

  return <ReauthDialog open={pending !== null} onConfirmed={() => pending?.(true)} onCancel={() => pending?.(false)} />;
}
