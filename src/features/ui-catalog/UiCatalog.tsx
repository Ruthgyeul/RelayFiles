"use client";

import { useEffect, useState } from "react";
import { THEME_KEYS, THEMES, type ThemeKey } from "@/config/theme";
import { OptionChip } from "@/shared/ui/Option";
import { Logo } from "@/shared/ui/Display";
import { AccountSection } from "./AccountSection";
import { ControlsSection } from "./ControlsSection";
import { DataSection } from "./DataSection";
import { FeedbackSection } from "./FeedbackSection";
import { OverlaysSection } from "./OverlaysSection";
import { TokensSection } from "./TokensSection";

/** Renders every shared primitive with its variants, with a theme switcher for review. */
export function UiCatalog({ initialTheme }: { initialTheme: ThemeKey }) {
  const [theme, setTheme] = useState<ThemeKey>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-4 pt-7 pb-14">
      <header className="flex flex-col gap-3">
        <Logo size={28} withText className="text-[18px]" />
        <p className="m-0 text-[13px] text-t4">Shared UI primitives from the design prototype. Development only.</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Theme">
          {THEME_KEYS.map((key) => (
            <OptionChip key={key} variant="filter" selected={theme === key} onClick={() => setTheme(key)} data-theme-key={key}>
              {THEMES[key]}
            </OptionChip>
          ))}
        </div>
      </header>
      <TokensSection />
      <ControlsSection />
      <FeedbackSection />
      <DataSection />
      <OverlaysSection />
      <AccountSection />
    </main>
  );
}
