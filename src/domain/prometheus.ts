/** Prometheus text exposition format 0.0.4 (what /metrics answers). */

export type MetricType = "gauge" | "counter";

export interface MetricSample {
  /** Label values must not identify a person: no account ids, names or file names. */
  labels?: Readonly<Record<string, string>>;
  value: number;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: MetricType;
  samples: readonly MetricSample[];
}

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const escapeHelp = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
const escapeLabel = (text: string) => text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");

function formatValue(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "+Inf";
  if (value === -Infinity) return "-Inf";
  return String(value);
}

function formatLabels(labels: Readonly<Record<string, string>> | undefined): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return "";
  for (const [key] of entries) if (!LABEL.test(key)) throw new RangeError(`invalid label name: ${key}`);
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

/** Renders metric families; a family without samples is left out (Prometheus reads it as absent). */
export function renderPrometheus(families: readonly MetricFamily[]): string {
  const lines: string[] = [];
  for (const family of families) {
    if (!NAME.test(family.name)) throw new RangeError(`invalid metric name: ${family.name}`);
    if (family.samples.length === 0) continue;
    lines.push(`# HELP ${family.name} ${escapeHelp(family.help)}`, `# TYPE ${family.name} ${family.type}`);
    for (const sample of family.samples) lines.push(`${family.name}${formatLabels(sample.labels)} ${formatValue(sample.value)}`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** One unlabelled gauge, or none when the value is unknown. */
export const gauge = (name: string, help: string, value: number | null): MetricFamily => ({ name, help, type: "gauge", samples: value === null ? [] : [{ value }] });
