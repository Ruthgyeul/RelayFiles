"use client";

import { Kbd } from "@/shared/ui/Display";
import { Modal, ModalHeader } from "@/shared/ui/Modal";
import { SHORTCUT_GROUPS } from "./shortcuts";

/** "Keyboard shortcuts" reference (560px, opened with ? or from the footer). */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} width={560} layer="shortcuts">
      <ModalHeader title="Keyboard shortcuts" icon="keyboard" onClose={onClose} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-x-7 gap-y-[18px] px-5 pt-4 pb-5">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-extrabold tracking-[.06em] text-t4 uppercase">{group.title}</span>
            {group.rows.map((row) => (
              <div key={row.description} className="flex items-center gap-2.5 py-[5px] text-[13px]">
                <span className="flex-1 text-t2">{row.description}</span>
                <span className="flex gap-1">
                  {row.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
