"use client";

import { useState } from "react";
import { MAX_INCIDENT_DURATION, MAX_INCIDENT_TEXT, MAX_INCIDENT_TITLE, type IncidentDto, type IncidentInput } from "@/contracts/status";
import { dayKeyIn, INCIDENT_SEVERITIES, SEVERITY_LABEL } from "@/domain/status";
import { Button } from "@/shared/ui/Button";
import { Field, FieldGroup, TextArea, TextInput } from "@/shared/ui/Field";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/Modal";
import { CheckRow, OptionChip } from "@/shared/ui/Option";

interface IncidentDialogProps {
  /** The incident being edited, or null to post a new one. */
  incident: IncidentDto | null;
  busy: boolean;
  onSave: (input: IncidentInput) => void;
  onClose: () => void;
}

const today = () => dayKeyIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

/** Post or edit an incident (design `incOpen`). */
export function IncidentDialog({ incident, busy, onSave, onClose }: IncidentDialogProps) {
  const [draft, setDraft] = useState<IncidentInput>(() => incident ?? { title: "", text: "", severity: "minor", date: today(), duration: "", resolved: false });
  const [error, setError] = useState(false);
  const set = <K extends keyof IncidentInput>(key: K, value: IncidentInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(false);
  };
  const heading = incident ? "Edit incident" : "Post incident";
  const save = () => {
    if (!draft.title.trim()) return setError(true);
    onSave({ ...draft, title: draft.title.trim(), text: draft.text.trim(), duration: draft.duration.trim() });
  };

  return (
    <Modal open onClose={onClose} width={480} layer="subdialog" label={heading}>
      <ModalHeader title={heading} onClose={onClose} />
      <ModalBody className="gap-3.5">
        <Field label="Title">
          <TextInput value={draft.title} maxLength={MAX_INCIDENT_TITLE} placeholder="e.g. Slow streaming" onChange={(event) => set("title", event.target.value)} />
        </Field>
        <FieldGroup label="Severity">
          <div className="flex flex-wrap gap-1.5">
            {INCIDENT_SEVERITIES.map((severity) => (
              <OptionChip key={severity} selected={draft.severity === severity} onClick={() => set("severity", severity)}>
                {SEVERITY_LABEL[severity].option}
              </OptionChip>
            ))}
          </div>
        </FieldGroup>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
          <Field label="Date">
            <TextInput type="date" value={draft.date} className="text-[14px] [color-scheme:dark]" onChange={(event) => event.target.value && set("date", event.target.value)} />
          </Field>
          <Field label="Duration">
            <TextInput value={draft.duration} maxLength={MAX_INCIDENT_DURATION} placeholder="e.g. 25 min" className="text-[14px]" onChange={(event) => set("duration", event.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <TextArea value={draft.text} rows={4} maxLength={MAX_INCIDENT_TEXT} placeholder="What happened and what was done" onChange={(event) => set("text", event.target.value)} />
        </Field>
        <CheckRow checked={draft.resolved} onCheckedChange={(resolved) => set("resolved", resolved)}>
          Resolved
        </CheckRow>
        {error && (
          <span role="alert" className="text-[13px] text-danger-text">
            Title is required.
          </span>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size={36} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={busy} onClick={save}>
          {incident ? "Save" : "Post"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
