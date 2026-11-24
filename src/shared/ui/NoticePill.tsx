import type { Notice } from "@/shared/hooks/useNotice";
import { Icon } from "./icon/Icon";

/** Short confirmation pill at the top center (shown for 1.8 s by its owner), with an optional action ("Undo"). */
export function NoticePill({ notice }: { notice: Notice }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[76px] left-1/2 z-(--z-notice) flex -translate-x-1/2 items-center gap-2 rounded-full bg-t1 px-4 py-2.5 text-[14px] font-bold whitespace-nowrap text-bg shadow-popover"
    >
      <Icon name="check" weight="bold" />
      <span>{notice.message}</span>
      {notice.action && (
        <button type="button" onClick={notice.action.run} className="-my-1 ml-1 rounded-full border-0 bg-bg px-3 py-1 text-[13px] font-bold text-t1">
          {notice.action.label}
        </button>
      )}
    </div>
  );
}
