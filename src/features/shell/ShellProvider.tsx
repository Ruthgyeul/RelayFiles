"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CreatedAccount, SessionAccount, SessionState } from "@/contracts/auth";
import { accountApi } from "@/features/account/api";
import { autoAccountStore } from "./auto-account";

/** Toast durations from the design (`note`, account switch toast). */
const NOTICE_MS = 1_800;
const ACCOUNT_TOAST_MS = 3_200;

export interface AccountToast {
  account: SessionAccount;
  meta: string;
}

/** Deployment values the browser needs (from env, rendered by the server). */
export interface ClientConfig {
  /** Origin used in share links, e.g. https://files.example.com */
  publicUrl: string;
  /** tus chunk size in bytes (below Cloudflare's request limit). */
  uploadChunkBytes: number;
}

export interface TokenToSave {
  id: string;
  name: string;
  token: string;
}

interface ShellContextValue {
  config: ClientConfig;
  session: SessionState;
  activeAccount: SessionAccount | null;
  notice: string | null;
  accountToast: AccountToast | null;
  signInOpen: boolean;
  tokenToSave: TokenToSave | null;
  autoAccountId: string | null;
  notify: (message: string) => void;
  dismissAccountToast: () => void;
  openSignIn: () => void;
  closeSignIn: () => void;
  applySession: (session: SessionState) => void;
  accountCreated: (created: CreatedAccount) => void;
  switchTo: (accountId: string) => Promise<void>;
  signOutAccount: (accountId: string) => Promise<void>;
  copyToken: (accountId: string) => Promise<void>;
  saveToken: (accountId: string) => Promise<void>;
  finishSaveToken: () => void;
  dismissAutoAccount: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>.");
  return value;
}

function toastMeta(account: SessionAccount, session: SessionState): string {
  return `${account.isAdmin ? "Admin · " : ""}Private root · ${session.usage?.rootItems ?? 0} items`;
}

/**
 * Client state of the app shell: signed-in accounts, toasts and account dialogs.
 * The server renders the first session state; changes go through the auth API and then
 * refresh the server components so every page sees the new active account.
 */
export function ShellProvider({ initialSession, config, children }: { initialSession: SessionState; config: ClientConfig; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState(initialSession);
  // A server refresh (router.refresh) renders new session data, e.g. storage use after an upload.
  const [renderedSession, setRenderedSession] = useState(initialSession);
  if (renderedSession !== initialSession) {
    setRenderedSession(initialSession);
    setSession(initialSession);
  }
  const [notice, setNotice] = useState<string | null>(null);
  const [accountToast, setAccountToast] = useState<AccountToast | null>(null);
  // Without an account and with sign-ups not open, the visitor has to sign in first.
  const [signInOpen, setSignInOpen] = useState(initialSession.accounts.length === 0 && initialSession.signupMode !== "open");
  const [tokenToSave, setTokenToSave] = useState<TokenToSave | null>(null);
  const rememberedAuto = useSyncExternalStore(autoAccountStore.subscribe, autoAccountStore.get, autoAccountStore.getServer);
  const autoAccountId = rememberedAuto && session.accounts.some((item) => item.id === rememberedAuto) ? rememberedAuto : null;
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoStarted = useRef(false);

  const notify = useCallback((message: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const dismissAccountToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    setAccountToast(null);
  }, []);

  /** Adopts a new session state; announces a change of active account like the design. */
  const applySession = useCallback(
    (next: SessionState) => {
      setSession((previous) => {
        const changed = previous.activeAccountId !== null && next.activeAccountId !== null && previous.activeAccountId !== next.activeAccountId;
        const account = next.accounts.find((item) => item.id === next.activeAccountId);
        if (changed && account) {
          clearTimeout(toastTimer.current);
          setAccountToast({ account, meta: toastMeta(account, next) });
          toastTimer.current = setTimeout(() => setAccountToast(null), ACCOUNT_TOAST_MS);
        }
        return next;
      });
      // Folder ids belong to one account, so a switch leaves the current folder.
      if (pathname.startsWith("/files/")) router.push("/files" as Route);
      router.refresh();
    },
    [pathname, router],
  );

  const accountCreated = useCallback(
    (created: CreatedAccount) => {
      setSignInOpen(false);
      applySession(created.session);
      setTokenToSave({ id: created.account.id, name: created.account.name, token: created.token });
    },
    [applySession],
  );

  const run = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        notify(error instanceof Error ? error.message : "Something went wrong.");
      }
    },
    [notify],
  );

  const value = useMemo<ShellContextValue>(
    () => ({
      config,
      session,
      activeAccount: session.accounts.find((item) => item.id === session.activeAccountId) ?? null,
      notice,
      accountToast,
      signInOpen,
      tokenToSave,
      autoAccountId,
      notify,
      dismissAccountToast,
      openSignIn: () => setSignInOpen(true),
      closeSignIn: () => setSignInOpen(false),
      applySession: (next) => {
        setSignInOpen(false);
        applySession(next);
      },
      accountCreated,
      switchTo: (accountId) => run(async () => applySession(await accountApi.switchAccount(accountId))),
      signOutAccount: (accountId) => run(async () => applySession(await accountApi.signOut(accountId))),
      copyToken: (accountId) =>
        run(async () => {
          await navigator.clipboard?.writeText(await accountApi.revealToken(accountId));
          notify("Token copied");
        }),
      saveToken: (accountId) =>
        run(async () => {
          const account = session.accounts.find((item) => item.id === accountId);
          if (!account) return;
          setTokenToSave({ id: account.id, name: account.name, token: await accountApi.revealToken(accountId) });
        }),
      finishSaveToken: () => setTokenToSave(null),
      dismissAutoAccount: () => autoAccountStore.set(null),
    }),
    [config, session, notice, accountToast, signInOpen, tokenToSave, autoAccountId, notify, dismissAccountToast, applySession, accountCreated, run],
  );

  // First visit with open sign-ups: create an anonymous account (design `componentDidMount`).
  useEffect(() => {
    if (autoStarted.current || initialSession.accounts.length > 0 || initialSession.signupMode !== "open") return;
    autoStarted.current = true;
    accountApi
      .createAnonymous()
      .then((created) => {
        autoAccountStore.set(created.account.id);
        setSession(created.session);
        router.refresh();
      })
      .catch(() => setSignInOpen(true));
  }, [initialSession, router]);

  return <ShellContext value={value}>{children}</ShellContext>;
}
