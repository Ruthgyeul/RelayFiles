"use client";

import type { DuplicateFile, DuplicateGroupDto } from "@/contracts/nodes";
import { formatShortDate, formatSize } from "@/domain/format";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { kindOf } from "@/shared/ui/node-kind";
import { CheckRow } from "@/shared/ui/Option";

interface DuplicateGroupCardProps {
  group: DuplicateGroupDto;
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  onReveal: (file: DuplicateFile) => void;
}

/** One set of files with the same content: size and copies, then each copy with its folder. */
export function DuplicateGroupCard({ group, selected, onToggle, onReveal }: DuplicateGroupCardProps) {
  const everySelected = group.files.every((file) => selected.has(file.id));
  return (
    <section className="flex flex-col rounded-xl border border-card-line bg-card" aria-label={`${group.files.length} copies of ${group.files[0]?.name ?? "a file"}`}>
      <header className="flex items-center gap-2 border-b border-card-line px-3 py-2 text-[12px] text-t3">
        <Icon name="files" size={16} className="text-accent-icon" />
        <span className="font-bold text-t2">{group.files.length} copies</span>
        <span>· {formatSize(Number(group.size))} each</span>
        <span className="ml-auto font-mono text-t4" title={group.sha256}>
          {group.sha256.slice(0, 8)}
        </span>
      </header>
      <ul className="m-0 flex list-none flex-col p-1">
        {group.files.map((file, index) => {
          const kind = kindOf({ type: "file", kind: file.kind, name: file.name });
          return (
            <li key={file.id} className="flex min-h-11 items-center gap-2 rounded-lg px-2">
              <CheckRow checked={selected.has(file.id)} onCheckedChange={(checked) => onToggle(file.id, checked)} aria-label={`Delete ${file.name}`} className="shrink-0">
                <span className="sr-only">{file.name}</span>
              </CheckRow>
              <Icon name={kind.icon} size={20} style={{ color: kind.color }} className="shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold text-t1" title={file.name}>
                  {file.name}
                </span>
                <span className="truncate text-[12px] text-t4">
                  {file.folderPath || "This folder"} · {formatShortDate(file.createdAt)}
                  {index === 0 ? " · oldest" : ""}
                </span>
              </span>
              <Button size={30} variant="ghost" icon="eye" iconSize={16} aria-label={`Show ${file.name}`} onClick={() => onReveal(file)} />
            </li>
          );
        })}
      </ul>
      {everySelected && <p className="m-0 px-3 pb-2 text-[12px] text-danger-text">Every copy is selected. Keep at least one.</p>}
    </section>
  );
}
