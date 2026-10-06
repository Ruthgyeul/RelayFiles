"use client";

import { useState, type FormEvent } from "react";
import type { CreatedAccount, SessionState, SignupMode } from "@/contracts/auth";
import { formatCountdown } from "@/domain/format";
import { useNow } from "@/shared/hooks/useNow";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { TextInput } from "@/shared/ui/Field";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalBody, ModalHeader } from "@/shared/ui/Modal";
import { accountApi, type AccountApi } from "./api";

export interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
  signupMode: SignupMode;
  /** Called after a token sign-in; the caller shows "Signed in as …". */
  onSignedIn: (session: SessionState) => void;
  /** Called after creating an account; the caller opens the "Save your account token" dialog. */
  onCreated: (created: CreatedAccount) => void;
  api?: Pick<AccountApi, "signInWithToken" | "createAnonymous">;
}

const MS_PER_SECOND = 1_000;

/** "Sign in" dialog from the design: token sign-in with lockout, or a new anonymous account. */
export function SignInDialog({ open, onClose, signupMode, onSignedIn, onCreated, api = accountApi }: SignInDialogProps) {
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [lock, setLock] = useState({ from: 0, until: 0 });
  const [busy, setBusy] = useState(false);
  const now = useNow(open && lock.until > 0);
  // `now` may predate the lock until the first tick; never count from before it started.
  const lockLeft = Math.max(0, lock.until - Math.max(now, lock.from)) / MS_PER_SECOND;
  const locked = lockLeft > 0;

  const fail = (caught: unknown) => {
    if (caught instanceof ApiClientError && caught.code === "RATE_LIMITED" && caught.retryAfter) {
      const from = Date.now();
      setLock({ from, until: from + caught.retryAfter * MS_PER_SECOND });
      setError("");
      return;
    }
    setError(caught instanceof Error ? caught.message : "Something went wrong.");
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (locked || busy) return;
    setBusy(true);
    try {
      const session = await api.signInWithToken(token.trim());
      setToken("");
      setLock({ from: 0, until: 0 });
      onSignedIn(session);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await api.createAnonymous(signupMode === "invite" ? invite.trim().toUpperCase() : undefined);
      setInvite("");
      onCreated(created);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={420}>
      <ModalHeader title="Sign in" titleSize={17} onClose={onClose} />
      <ModalBody className="gap-3.5">
        <p className="m-0 text-[14px] leading-[1.5] text-pretty text-t2">Accounts are anonymous. Paste an account token to sign in, or create a new account.</p>
        <form onSubmit={signIn} className="flex flex-col gap-3.5">
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
          {locked && (
            <div role="status" className="flex gap-2.5 rounded-xl border border-danger-line bg-danger-bg px-3.5 py-3 text-[13px] leading-[1.5] text-danger-pale">
              <Icon name="lock-key" weight="fill" size={18} className="text-danger-icon" />
              <span>Too many failed attempts. Try again in {formatCountdown(lockLeft)}.</span>
            </div>
          )}
          <Button type="submit" variant="primary" size={44} icon="key" iconSize={18} hoverable disabled={busy} className="gap-2 border-0">
            Sign in with token
          </Button>
        </form>
        <div className="flex items-center gap-2.5 text-[12px] text-t4">
          <span className="h-px flex-1 bg-ctrl" />
          or
          <span className="h-px flex-1 bg-ctrl" />
        </div>
        <SignupOptions mode={signupMode} invite={invite} busy={busy} onInvite={setInvite} onCreate={create} clearError={() => setError("")} />
      </ModalBody>
    </Modal>
  );
}

interface SignupOptionsProps {
  mode: SignupMode;
  invite: string;
  busy: boolean;
  onInvite: (value: string) => void;
  onCreate: () => void;
  clearError: () => void;
}

function SignupOptions({ mode, invite, busy, onInvite, onCreate, clearError }: SignupOptionsProps) {
  if (mode === "closed") {
    return (
      <div className="flex gap-2.5 rounded-xl border border-ctrl bg-elev px-3.5 py-3 text-[13px] leading-[1.5] text-t2">
        <Icon name="lock-simple" size={18} className="text-t4" />
        <span>New sign-ups are closed on this server. Existing accounts can still sign in with their token.</span>
      </div>
    );
  }
  const createButton = (
    <Button variant="secondary" size={44} icon="sparkle" iconSize={18} hoverable disabled={busy} onClick={onCreate} className="gap-2">
      Create anonymous account
    </Button>
  );
  if (mode === "invite") {
    return (
      <>
        <TextInput
          height={44}
          surface="sunk"
          value={invite}
          onChange={(event) => {
            onInvite(event.target.value);
            clearError();
          }}
          placeholder="Invite code · XXXX-XXXX"
          aria-label="Invite code"
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-[14px] uppercase"
        />
        {createButton}
        <span className="text-center text-[12px] text-t4">This server is invite-only. Ask the admin for a code.</span>
      </>
    );
  }
  return (
    <>
      {createButton}
      <span className="text-center text-[12px] text-t4">A unique name, ID and token are generated for you.</span>
    </>
  );
}
