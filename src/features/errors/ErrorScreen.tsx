import type { ReactNode } from "react";
import { TONE } from "@/shared/styles/palette";
import { Logo } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { Pill } from "@/shared/ui/Pill";
import { CopyRequestId } from "./CopyRequestId";
import type { ErrorPreset } from "./presets";

export interface ErrorScreenProps {
  preset: ErrorPreset;
  /** Replaces the preset description (e.g. a maintenance announcement). */
  description?: ReactNode;
  actions?: ReactNode;
  /** Request id or error digest shown for support. */
  reference?: string;
}

/**
 * Full-page error / warning screen in the design language of the share page status cards
 * (docs/plan.md §9.1): header with the logo, centered card, icon box, code badge, actions.
 */
export function ErrorScreen({ preset, description, actions, reference }: ErrorScreenProps) {
  const tone = TONE[preset.tone];
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-[60px] shrink-0 items-center border-b border-line bg-header px-5">
        <Logo size={28} withText className="text-[18px]" />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <section
          aria-labelledby="error-title"
          className="flex w-[min(440px,100%)] flex-col items-center gap-3 rounded-2xl border border-card-line bg-card px-6 py-7 text-center"
        >
          <span className="flex size-14 items-center justify-center rounded-[14px]" style={{ background: tone.bg }}>
            <Icon name={preset.icon} weight="fill" size={26} style={{ color: tone.icon }} />
          </span>
          <Pill bg={tone.bg} color={tone.text} className="font-mono text-[12px] font-semibold tracking-normal">
            {preset.badge}
          </Pill>
          <h1 id="error-title" className="m-0 text-[19px] font-bold">
            {preset.title}
          </h1>
          <p className="m-0 text-[14px] leading-[1.5] text-pretty text-t3">{description ?? preset.description}</p>
          {actions && <div className="mt-1 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">{actions}</div>}
          {reference && <CopyRequestId value={reference} />}
        </section>
      </main>
    </div>
  );
}
