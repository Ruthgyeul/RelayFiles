"use client";

import { THEME_KEYS, THEMES, type ThemeKey } from "@/config/theme";
import { Icon } from "@/shared/ui/icon/Icon";
import { OptionChip } from "@/shared/ui/Option";

/** Server-wide color theme (an addition to the design, which sets it in the editor). */
export function ThemeCard({ theme, busy, onTheme }: { theme: ThemeKey; busy: boolean; onTheme: (theme: ThemeKey) => void }) {
  return (
    <section aria-label="Theme" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-accent-soft">
          <Icon name="palette" size={20} className="text-accent-icon" />
        </span>
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[17px] font-bold">Theme</h2>
          <span className="text-[12px] text-t4">Colors for every page and account on this server.</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {THEME_KEYS.map((key) => (
          <OptionChip key={key} selected={theme === key} disabled={busy} onClick={() => onTheme(key)}>
            {THEMES[key]}
          </OptionChip>
        ))}
      </div>
    </section>
  );
}
