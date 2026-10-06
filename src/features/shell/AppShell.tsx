"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SessionState } from "@/contracts/auth";
import { NewTokenDialog } from "@/features/account/NewTokenDialog";
import { SignInDialog } from "@/features/account/SignInDialog";
import { isTypingTarget } from "@/features/shortcuts/shortcuts";
import { ShortcutsDialog } from "@/features/shortcuts/ShortcutsDialog";
import { TransfersPanel } from "@/features/transfers/TransfersPanel";
import { TransfersProvider } from "@/features/transfers/TransfersProvider";
import { readLocalSetting, writeLocalSetting } from "@/shared/lib/local-setting";
import { AppFooter } from "./AppFooter";
import { AppHeader } from "./AppHeader";
import { BannerStack } from "./BannerStack";
import { Drawer } from "./Drawer";
import { activeNavItem } from "./nav";
import { PageTitleContext } from "./page-title";
import { ShellProvider, useShell, type ClientConfig } from "./ShellProvider";
import { Sidebar } from "./Sidebar";
import { Toasts } from "./Toasts";

const SIDEBAR_KEY = "relay.sidebarCollapsed";
const DESKTOP_QUERY = "(min-width: 1024px)";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** Signed-in application frame: sidebar or drawer, header, banners, page, footer, dialogs. */
export function AppShell({ initialSession, config, children }: { initialSession: SessionState; config: ClientConfig; children: ReactNode }) {
  return (
    <ShellProvider initialSession={initialSession} config={config}>
      <TransfersProvider>
        <Frame>{children}</Frame>
        <TransfersPanel />
      </TransfersProvider>
    </ShellProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const shell = useShell();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  // The collapsed sidebar is a per-device preference, read after hydration.
  useEffect(() => {
    const saved = readLocalSetting(SIDEBAR_KEY, isBoolean);
    if (saved) queueMicrotask(() => setCollapsed(true));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "?" && !isTypingTarget(event.target)) setShortcutsOpen((open) => !open);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleNavigation = () => {
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      setCollapsed((value) => {
        writeLocalSetting(SIDEBAR_KEY, !value);
        return !value;
      });
    } else {
      setDrawerOpen((open) => !open);
    }
  };
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const title = pageTitle ?? activeNavItem(pathname)?.title ?? "RelayFiles";

  return (
    <PageTitleContext value={setPageTitle}>
      <div className="flex min-h-dvh bg-bg text-t1">
        <Sidebar collapsed={collapsed} />
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <AppHeader title={title} onMenu={toggleNavigation} menuExpanded={drawerOpen} />
          <Drawer open={drawerOpen} onClose={closeDrawer} />
          <main className="mx-auto box-border flex w-full max-w-[880px] flex-1 flex-col gap-3 px-4 pt-7 pb-14">
            <BannerStack />
            {children}
          </main>
          <AppFooter onShortcuts={() => setShortcutsOpen(true)} />
        </div>
      </div>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <SignInDialog
        open={shell.signInOpen}
        onClose={shell.closeSignIn}
        signupMode={shell.session.signupMode}
        onSignedIn={(session) => {
          shell.applySession(session);
          const account = session.accounts.find((item) => item.id === session.activeAccountId);
          if (account) shell.notify(`Signed in as ${account.name}`);
        }}
        onCreated={shell.accountCreated}
      />
      <NewTokenDialog account={shell.tokenToSave} onDone={shell.finishSaveToken} onCopied={() => shell.notify("Token copied")} />
      <Toasts />
    </PageTitleContext>
  );
}
