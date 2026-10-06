import { FIXED_COLOR, KIND_COLOR, THEME_COLOR } from "@/shared/styles/palette";
import { Icon } from "@/shared/ui/icon/Icon";
import { ICONS, type IconName } from "@/shared/ui/icon/registry";
import { Section } from "./Section";

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-t3">
      <span className="size-6 shrink-0 rounded-md border border-card-line" style={{ background: value }} />
      <span className="font-mono">{name}</span>
    </div>
  );
}

function SwatchGrid({ colors }: { colors: Record<string, string> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
      {Object.entries(colors).map(([name, value]) => (
        <Swatch key={name} name={name} value={value} />
      ))}
    </div>
  );
}

export function TokensSection() {
  return (
    <>
      <Section id="theme-colors" title="Theme colors">
        <SwatchGrid colors={THEME_COLOR} />
      </Section>
      <Section id="fixed-colors" title="Fixed palette">
        <SwatchGrid colors={{ ...FIXED_COLOR, ...KIND_COLOR }} />
      </Section>
      <Section id="type" title="Typography">
        <div className="flex flex-col gap-1">
          <span className="text-[34px] font-bold tracking-[-0.01em]">RelayFiles 34 / 700</span>
          <span className="text-[20px] font-bold">Heading 20 / 700</span>
          <span className="text-[15px] font-bold">Row title 15 / 700 · 한글 파일명.mp4</span>
          <span className="text-[13px] text-t4">Meta 13 / 400 t4</span>
          <span className="text-[10px] font-extrabold tracking-[.04em]">BADGE 10 / 800</span>
          <span className="font-mono text-[13px] text-accent-text">https://relayfiles.example/d/abcd1234</span>
        </div>
      </Section>
      <Section id="icons" title={`Icons (${Object.keys(ICONS).length})`}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          {(Object.keys(ICONS) as IconName[]).map((name) => (
            <div key={name} className="flex items-center gap-2 text-[11px] text-t3">
              <Icon name={name} size={20} className="text-t1" />
              <Icon name={name} size={20} weight="bold" className="text-t1" />
              <Icon name={name} size={20} weight="fill" className="text-accent-icon" />
              <span className="truncate font-mono">{name}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
