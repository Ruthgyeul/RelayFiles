"use client";

import type { Route } from "next";
import Link from "next/link";
import type { FolderCrumb } from "@/contracts/nodes";
import { collapseCrumbs, CRUMB_LIMIT, pathString } from "@/domain/tree";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { folderHref } from "@/shared/lib/routes";
import type { DropTargetProps } from "./useDragMove";

const crumbClass = "flex h-8 max-w-[200px] items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-2 text-[13px] whitespace-nowrap no-underline";

/** Breadcrumbs (collapsed to 3 / 6 levels) and the copyable folder path. */
interface PathBarProps {
  path: FolderCrumb[];
  onCopyPath: (path: string) => void;
  /** Drop handlers so dragged items can be moved onto a crumb. */
  dropFor?: (folderId: string) => DropTargetProps | undefined;
  over?: string | null;
  /** Where each crumb leads (default: the folder in the File Manager). Favorites paths mix organizing and real folders. */
  hrefOf?: (index: number) => Route;
  /** Icon of the first crumb (default: the drive of the account root). */
  rootIcon?: IconName;
}

export function PathBar({ path, onCopyPath, dropFor, over, hrefOf, rootIcon = "hard-drives" }: PathBarProps) {
  const { small } = useViewport();
  const href = (index: number) => (hrefOf ? hrefOf(index) : folderHref(path[index]!.id, index === 0));
  const slots = collapseCrumbs(path, small ? CRUMB_LIMIT.mobile : CRUMB_LIMIT.desktop);
  const last = path.length - 1;
  const text = pathString(path);
  return (
    <nav aria-label="Path" className="flex min-h-8 flex-wrap items-center gap-0.5 px-0.5 text-[13px]">
      {slots.map((slot, position) => {
        const separator = position > 0 && <Icon name="caret-right" size={12} className="text-t5" />;
        if (slot.kind === "gap") {
          const target = slot.hidden.at(-1)!;
          return (
            <span key="gap" className="contents">
              {separator}
              <Link href={href(path.indexOf(target))} title={slot.hidden.map((crumb) => crumb.name).join(" / ")} className={cn(crumbClass, "font-semibold text-t3 hover:bg-btn hover:text-t3")}>
                …
              </Link>
            </span>
          );
        }
        const current = slot.index === last;
        const content = (
          <>
            {slot.index === 0 && <Icon name={rootIcon} size={15} />}
            <span className="truncate">{slot.crumb.name}</span>
          </>
        );
        return (
          <span key={slot.crumb.id} className="contents">
            {separator}
            {current ? (
              <span aria-current="page" title={slot.crumb.name} className={cn(crumbClass, "font-bold text-t1")}>
                {content}
              </span>
            ) : (
              <Link
                {...dropFor?.(slot.crumb.id)}
                href={href(slot.index)}
                title={slot.crumb.name}
                className={cn(crumbClass, "font-semibold text-t3 hover:bg-btn hover:text-t3", over === slot.crumb.id && "border-accent-hi bg-accent-soft")}
              >
                {content}
              </Link>
            )}
          </span>
        );
      })}
      <span className="flex-1" />
      <button
        type="button"
        title="Copy path"
        aria-label="Copy path"
        onClick={() => onCopyPath(text)}
        className="flex h-[30px] max-w-full items-center gap-1.5 overflow-hidden rounded-lg border-0 bg-transparent px-2 font-mono text-[12px] font-semibold text-t4 hover:bg-btn"
      >
        <Icon name="copy" size={13} />
        <span className="truncate">{text}</span>
      </button>
    </nav>
  );
}
