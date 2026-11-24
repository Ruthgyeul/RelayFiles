"use client";

import { useState } from "react";
import { AUTO_CLEAN } from "@/config/policy";
import { cleanAgeText, cleanPreviewText, cleanRuleText, type CleanBasis, type CleanRule } from "@/domain/auto-clean";
import { useApiQuery } from "@/shared/hooks/useApiQuery";
import { errorMessage } from "@/shared/lib/api-client";
import { filesApi } from "@/shared/lib/files-api";
import { Button } from "@/shared/ui/Button";
import { FieldGroup } from "@/shared/ui/Field";
import { Modal, ModalHeader } from "@/shared/ui/Modal";
import { OptionChip } from "@/shared/ui/Option";

export interface AutoCleanRequest {
  folderId: string;
  name: string;
}

const BASIS_LABEL: Record<CleanBasis, string> = { modified: "Date modified", created: "Date added" };
const DEFAULT_RULE: CleanRule = { olderThanDays: AUTO_CLEAN.defaultDays, basis: "modified" };

/**
 * "Auto clean": every day, files directly in the folder older than the chosen age move to
 * Recently deleted (restorable there). Shows how many files the rule would move right now.
 */
export function AutoCleanDialog({ request, onClose, onDone }: { request: AutoCleanRequest | null; onClose: () => void; onDone: (message: string) => void }) {
  const [choice, setChoice] = useState<CleanRule | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saved = useApiQuery(request?.folderId ?? null, (folderId, signal) => filesApi.autoClean(folderId, undefined, signal));
  const savedRule = saved.status === "ready" ? saved.data.rule : null;
  const rule = choice ?? savedRule ?? DEFAULT_RULE;
  const ready = saved.status === "ready" && request !== null;
  const preview = useApiQuery(ready ? `${request.folderId}:${rule.olderThanDays}:${rule.basis}` : null, (_, signal) => filesApi.autoClean(request?.folderId ?? "", rule, signal));
  const days = [...new Set([...AUTO_CLEAN.dayChoices, ...(savedRule ? [savedRule.olderThanDays] : [])])].sort((a, b) => a - b);

  const close = () => {
    setChoice(null);
    setError("");
    onClose();
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onDone(message);
      close();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const save = () => request && void run(() => filesApi.saveAutoClean(request.folderId, rule), "Auto clean is on");
  const turnOff = () => request && void run(() => filesApi.removeAutoClean(request.folderId), "Auto clean is off");

  const failed = saved.error ?? preview.error;
  return (
    <Modal open={request !== null} onClose={close} width={480} layer="subdialog" className="overflow-hidden">
      <ModalHeader title="Auto clean" subtitle={request?.name} icon="broom" onClose={close} closeSize={36} />
      <div className="flex flex-col gap-3 px-5 py-4">
        <FieldGroup label="Move files older than">
          <div className="flex flex-wrap gap-2">
            {days.map((value) => (
              <OptionChip key={value} selected={rule.olderThanDays === value} disabled={!ready} onClick={() => setChoice({ ...rule, olderThanDays: value })}>
                {cleanAgeText(value)}
              </OptionChip>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup label="By">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(BASIS_LABEL) as CleanBasis[]).map((basis) => (
              <OptionChip key={basis} selected={rule.basis === basis} disabled={!ready} onClick={() => setChoice({ ...rule, basis })}>
                {BASIS_LABEL[basis]}
              </OptionChip>
            ))}
          </div>
        </FieldGroup>
        <p className="m-0 text-[13px] text-t3">{cleanRuleText(rule)} Folders inside are left alone.</p>
        <p className="m-0 text-[13px] font-semibold text-t2" aria-live="polite">
          {preview.data && preview.status !== "loading" ? cleanPreviewText(preview.data.due, AUTO_CLEAN.perRunLimit) : "Counting files…"}
        </p>
        {(error || failed) && <p className="m-0 text-[13px] text-danger-text">{error || failed}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-card-line px-5 py-3">
        {savedRule && (
          <Button size={38} variant="danger-outline" disabled={busy} onClick={turnOff}>
            Turn off
          </Button>
        )}
        <span className="flex-1" />
        <Button size={38} onClick={close}>
          Cancel
        </Button>
        <Button size={38} variant="primary" disabled={!ready || busy} onClick={save}>
          {savedRule ? "Save" : "Turn on"}
        </Button>
      </div>
    </Modal>
  );
}
