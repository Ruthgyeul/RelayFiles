"use client";

import { useRef, useState } from "react";
import { LOGIN } from "@/config/policy";
import { SIGNUP_MODES, type CreatedAccount, type SignupMode } from "@/contracts/auth";
import { ID_LENGTH, newAccountId, newAccountToken, newAnonName } from "@/domain/ids";
import { failureMessage, lockSecondsAfter } from "@/domain/lockout";
import { NewTokenDialog } from "@/features/account/NewTokenDialog";
import { SignInDialog, type SignInDialogProps } from "@/features/account/SignInDialog";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { OptionChip } from "@/shared/ui/Option";
import { Row, Section } from "./Section";

/** Offline stand-in for the account API so the dialogs can be reviewed without a server. */
function useCatalogApi(): NonNullable<SignInDialogProps["api"]> {
  const failures = useRef(0);
  return {
    async signInWithToken(token) {
      failures.current += 1;
      const lock = lockSecondsAfter(failures.current, LOGIN);
      if (lock > 0) throw new ApiClientError("RATE_LIMITED", "Too many failed attempts.", 429, lock);
      throw new ApiClientError("INVALID_TOKEN", failureMessage(token, failures.current, LOGIN, ID_LENGTH.token), 401);
    },
    async createAnonymous(inviteCode) {
      if (inviteCode !== undefined && !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(inviteCode)) {
        throw new ApiClientError("INVALID_INVITE", "Invalid or already used invite code.", 400);
      }
      const account = { id: newAccountId(), name: newAnonName(), color: "var(--accent)", isAdmin: false, neverExpire: false, deletesAt: null, quotaBytes: null };
      return { account, token: newAccountToken(), session: { accounts: [account], activeAccountId: account.id, signupMode: "open", usage: { usedBytes: "0", rootItems: 0 } } } satisfies CreatedAccount;
    },
  };
}

export function AccountSection() {
  const [mode, setMode] = useState<SignupMode>("open");
  const [signInOpen, setSignInOpen] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const api = useCatalogApi();

  return (
    <Section id="account" title="Account dialogs">
      <Row>
        {SIGNUP_MODES.map((key) => (
          <OptionChip key={key} variant="filter" selected={mode === key} onClick={() => setMode(key)} data-signup-mode={key}>
            {key}
          </OptionChip>
        ))}
      </Row>
      <Row>
        <Button onClick={() => setSignInOpen(true)} data-testid="open-sign-in">
          Sign in dialog
        </Button>
      </Row>
      <SignInDialog
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        signupMode={mode}
        api={api}
        onSignedIn={() => setSignInOpen(false)}
        onCreated={(result) => {
          setSignInOpen(false);
          setCreated(result);
        }}
      />
      <NewTokenDialog account={created ? { ...created.account, token: created.token } : null} onDone={() => setCreated(null)} />
    </Section>
  );
}
