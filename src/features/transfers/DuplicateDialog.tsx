"use client";

import type { DuplicatePolicy } from "@/contracts/uploads";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { Modal } from "@/shared/ui/Modal";

export interface DuplicateRequest {
  names: string[];
  folderName: string;
}

/** Names listed before "and N more" (design). */
const SHOWN_NAMES = 5;

const OPTIONS: { policy: DuplicatePolicy; label: string; description: string; icon: IconName }[] = [
  { policy: "replace", label: "Replace", description: "Overwrite the existing files", icon: "swap" },
  { policy: "keep", label: "Keep both", description: 'Upload as "name (1).ext"', icon: "copy" },
  { policy: "skip", label: "Skip duplicates", description: "Upload only new files", icon: "skip-forward" },
];

/** "N files already exist in …" (440px): replace, keep both or skip. */
export function DuplicateDialog({ request, onChoose, onClose }: { request: DuplicateRequest | null; onChoose: (policy: DuplicatePolicy) => void; onClose: () => void }) {
  const count = request?.names.length ?? 0;
  const title = `${count} ${count === 1 ? "file already exists" : "files already exist"} in ${request?.folderName || "this folder"}`;
  return (
    <Modal open={request !== null} onClose={onClose} width={440} layer="dialog" label={title}>
      <div className="flex flex-col gap-2.5 px-5 pt-5">
        <span className="flex items-center gap-2.5 text-[17px] font-bold">
          <Icon name="copy" weight="fill" size={22} className="text-warn-strong" />
          {title}
        </span>
        <div className="flex flex-col gap-1 rounded-[10px] bg-bg px-3 py-2.5 font-mono text-[13px] text-t2">
          {request?.names.slice(0, SHOWN_NAMES).map((name) => (
            <span key={name} className="truncate">
              {name}
            </span>
          ))}
          {count > SHOWN_NAMES && <span className="font-sans text-t4">and {count - SHOWN_NAMES} more</span>}
        </div>
      </div>
      <div className="flex flex-col gap-2 px-5 py-4">
        {OPTIONS.map((option) => (
          <button
            key={option.policy}
            type="button"
            onClick={() => {
              onClose();
              onChoose(option.policy);
            }}
            className="flex items-center gap-3 rounded-xl border border-ctrl bg-btn px-3.5 py-3 text-left text-t1 hover:border-accent-hi hover:bg-btn-h"
          >
            <Icon name={option.icon} size={20} className="text-accent-icon" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-bold">{option.label}</span>
              <span className="text-[12px] text-t4">{option.description}</span>
            </span>
          </button>
        ))}
        <button type="button" onClick={onClose} className="h-[38px] border-0 bg-transparent text-[14px] font-bold text-t3">
          Cancel upload
        </button>
      </div>
    </Modal>
  );
}
