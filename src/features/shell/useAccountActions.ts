"use client";

import { useCallback } from "react";
import type { SessionState } from "@/contracts/auth";
import { accountApi } from "@/features/account/api";
import { errorMessage } from "@/shared/lib/api-client";
import { COPY_FAILED, copyText } from "@/shared/lib/clipboard";
import type { TokenToSave } from "./ShellProvider";

interface AccountActionsContext {
  session: SessionState;
  applySession: (session: SessionState) => void;
  notify: (message: string) => void;
  showToken: (token: TokenToSave) => void;
}

/** The account menu's actions: switch, sign out, copy or save a token. A failure becomes a notice. */
export function useAccountActions({ session, applySession, notify, showToken }: AccountActionsContext) {
  const run = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        notify(errorMessage(error));
      }
    },
    [notify],
  );

  const switchTo = useCallback((accountId: string) => run(async () => applySession(await accountApi.switchAccount(accountId))), [run, applySession]);
  const signOutAccount = useCallback((accountId: string) => run(async () => applySession(await accountApi.signOut(accountId))), [run, applySession]);
  const copyToken = useCallback(
    (accountId: string) =>
      run(async () => {
        notify((await copyText(await accountApi.revealToken(accountId))) ? "Token copied" : COPY_FAILED);
      }),
    [run, notify],
  );
  const saveToken = useCallback(
    (accountId: string) =>
      run(async () => {
        const account = session.accounts.find((item) => item.id === accountId);
        if (!account) return;
        showToken({ id: account.id, name: account.name, token: await accountApi.revealToken(accountId) });
      }),
    [run, session.accounts, showToken],
  );

  return { switchTo, signOutAccount, copyToken, saveToken };
}
