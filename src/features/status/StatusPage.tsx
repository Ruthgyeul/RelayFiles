"use client";

import { useEffect, useState } from "react";
import { STATUS } from "@/config/policy";
import type { IncidentDto, IncidentInput, StatusData } from "@/contracts/status";
import { connectionLevel, connectionStats } from "@/domain/status";
import { usePageTitle } from "@/features/shell/page-title";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError } from "@/shared/lib/api-client";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { statusApi } from "./api";
import { IncidentDialog } from "./IncidentDialog";
import { IncidentsCard } from "./IncidentsCard";
import { ServerInfoCard } from "./ServerInfoCard";
import { ServicesCard } from "./ServicesCard";
import { ConnectionCard, OverallCard } from "./StatusCards";
import { usePing } from "./usePing";

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

/** Public Status page (design `isStatus`). */
export function StatusPage({ initial }: { initial: StatusData }) {
  usePageTitle("Status");
  const { activeAccount, notify } = useShell();
  const isAdmin = activeAccount?.isAdmin === true;
  const [data, setData] = useState(initial);
  const [editing, setEditing] = useState<IncidentDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<IncidentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const { pings, online, connection, check } = usePing();
  const stats = connectionStats(pings);
  const level = connectionLevel(stats, online);

  const refresh = () =>
    statusApi
      .get()
      .then(setData)
      .catch(() => undefined);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), STATUS.refreshMs);
    return () => clearInterval(timer);
  }, []);

  const run = async (action: () => Promise<string>, done: () => void) => {
    setBusy(true);
    try {
      notify(await action());
      done();
      await refresh();
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  const save = (input: IncidentInput) =>
    void run(
      async () => {
        if (editing && editing !== "new") {
          await statusApi.edit(editing.id, input);
          return "Incident updated";
        }
        await statusApi.post(input);
        return "Incident posted";
      },
      () => setEditing(null),
    );

  return (
    <div className="flex flex-col gap-3">
      <OverallCard level={level} lastCheck={stats.last?.at ?? null} onCheck={() => void check()} />
      <ConnectionCard stats={stats} online={online} connectionType={connection.type} latency={data.latency} />
      <ServicesCard components={data.components} level={level} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
        <ServerInfoCard server={data.server} />
        <IncidentsCard incidents={data.incidents} isAdmin={isAdmin} onNew={() => setEditing("new")} onEdit={setEditing} onDelete={setDeleting} />
      </div>
      {editing && isAdmin && <IncidentDialog key={editing === "new" ? "new" : editing.id} incident={editing === "new" ? null : editing} busy={busy} onSave={save} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this incident?"
        description={deleting ? `"${deleting.title}" is removed from the Status page.` : undefined}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() =>
          void run(
            async () => {
              await statusApi.remove(deleting!.id);
              return "Incident deleted";
            },
            () => setDeleting(null),
          )
        }
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
