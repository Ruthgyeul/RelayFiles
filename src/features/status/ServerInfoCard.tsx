import type { StatusData } from "@/contracts/status";
import { formatDayKey } from "@/domain/status";

function tlsText(tls: StatusData["server"]["tls"]): string {
  switch (tls.state) {
    case "valid":
      return `Valid · expires ${formatDayKey(tls.expiresAt.slice(0, 10))}`;
    case "expired":
      return `Expired ${formatDayKey(tls.expiresAt.slice(0, 10))}`;
    case "unreadable":
      return "Can't read certificate";
    default:
      return "Not configured";
  }
}

/** Server facts (design `st.server`): location, response times, certificate, 90-day uptime. */
export function ServerInfoCard({ server }: { server: StatusData["server"] }) {
  const rows = [
    { label: "Location", value: server.location },
    { label: "Response p50 / p95", value: server.p50 === null || server.p95 === null ? "No data yet" : `${server.p50} / ${server.p95} ms` },
    { label: "TLS certificate", value: tlsText(server.tls) },
    { label: "Uptime (90 days)", value: server.uptime === null ? "No data yet" : `${server.uptime.toFixed(2)}%` },
  ];
  return (
    <section aria-label="Server" className="flex flex-col gap-2.5 rounded-2xl border border-card-line bg-card p-5">
      <h2 className="m-0 text-[17px] font-bold">Server</h2>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-2.5 border-t border-card-line py-1.5 text-[13px]">
          <span className="text-t4">{row.label}</span>
          <span className="text-right font-semibold">{row.value}</span>
        </div>
      ))}
    </section>
  );
}
