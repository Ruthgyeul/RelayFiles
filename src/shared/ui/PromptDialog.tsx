"use client";

import { useState, type FocusEvent, type FormEvent } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./icon/Icon";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

export interface PromptDialogProps {
  open: boolean;
  title: string;
  initialValue?: string;
  confirmLabel: string;
  icon?: IconName;
  iconColor?: string;
  /** Folder icons are filled, file icons regular (design rename dialog). */
  iconWeight?: "regular" | "fill";
  /** Returns an error message, or an empty string when the value is valid. */
  validate?: (value: string) => string;
  /** Selection range applied on focus, e.g. the file name without its extension. */
  selectOnFocus?: (value: string) => [number, number];
  /** Error reported by the caller after submit (e.g. a server-side conflict). */
  error?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Single-field input dialog in the style of the design's rename dialog (w420). Replaces window.prompt. */
export function PromptDialog({
  open,
  title,
  initialValue = "",
  confirmLabel,
  icon,
  iconColor,
  iconWeight = "fill",
  validate,
  selectOnFocus,
  error: externalError,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  // A server error belongs to the value that was submitted; editing the field clears it.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const localError = value && validate ? validate(value) : "";
  const error = localError || (value === submitted ? externalError : "") || "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = validate ? validate(value) : "";
    if (message) return;
    setSubmitted(value);
    onSubmit(value);
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (!selectOnFocus) return;
    const [start, end] = selectOnFocus(event.target.value);
    event.target.setSelectionRange(start, end);
  };

  return (
    <Modal open={open} onClose={onCancel} width={420} layer="subdialog" label={title}>
      <form onSubmit={submit} className="flex flex-col gap-3.5 p-5">
        <div className="flex items-center gap-2.5">
          {icon && <Icon name={icon} weight={iconWeight} size={22} style={{ color: iconColor }} />}
          <span className="flex-1 text-[16px] font-bold">{title}</span>
          <IconButton icon="x" label="Close" size={36} iconSize={18} onClick={onCancel} />
        </div>
        <input
          autoFocus
          spellCheck={false}
          aria-label={title}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={onFocus}
          aria-invalid={!!error}
          className="h-11 rounded-[10px] border border-accent-hi bg-bg px-3.5 text-[15px] text-t1 outline-none"
        />
        {error && (
          <span role="alert" className="flex items-center gap-1.5 text-[13px] text-danger-text">
            <Icon name="warning-circle" />
            {error}
          </span>
        )}
        <div className="flex justify-end gap-2">
          <Button size={38} className="px-4" onClick={onCancel}>
            Cancel
          </Button>
          <Button size={38} className="px-4" variant="primary" type="submit" disabled={!!error}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
