import { Avatar } from "@/shared/ui/Avatar";
import { BarChart, Meter, StatTile, type Bar } from "@/shared/ui/Display";
import { Row, Section } from "./Section";

/** Fixed specimen series for visual review of the chart primitive (not application data). */
const SPECIMEN_BARS: Bar[] = Array.from({ length: 30 }, (_, i) => ({ value: 20 + ((i * 37) % 70) }));
const PARTIAL_BARS: Bar[] = Array.from({ length: 30 }, (_, i) => ({ value: i < 18 ? null : 30 + ((i * 23) % 60) }));
const EMPTY_BARS: Bar[] = Array.from({ length: 30 }, () => ({ value: null }));

export function DataSection() {
  return (
    <>
      <Section id="avatars" title="Avatars">
        <Row>
          <Avatar seed="abcdefghjkmn" size={38} active />
          <Avatar seed="p9q8r7s6t5u4" size={38} />
          <Avatar seed="z2y3x4w5v6u7" size={36} />
          <Avatar seed="abcdefghjkmn" size={68} bordered />
        </Row>
      </Section>

      <Section id="stats" title="Stats and meters">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
          <StatTile label="AVG 1H" value="12.4 MB/s" />
          <StatTile label="LATENCY" value="38 ms" sub="Excellent" valueSize={20} valueColor="var(--color-ok-text)" />
          <StatTile label="PACKET LOSS" value="0%" sub="No failed checks" valueSize={20} />
        </div>
        <Meter value={21} height={4} label="Storage" />
        <Meter value={72} label="Quota" color="var(--color-warn-orange)" />
        <Meter value={93} label="Quota full" color="var(--color-danger-icon)" />
      </Section>

      <Section id="charts" title="Charts">
        <BarChart bars={SPECIMEN_BARS} height={44} gap={2} color="var(--accentHi)" label="Specimen chart" />
        <BarChart bars={PARTIAL_BARS} height={90} emptyHeight="8%" label="Partial history" className="rounded-xl bg-sunk p-2" />
        <BarChart bars={EMPTY_BARS} height={22} gap={2} shape="cell" label="No history" />
      </Section>
    </>
  );
}
