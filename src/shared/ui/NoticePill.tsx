import { Icon } from "./icon/Icon";

/** Short confirmation pill at the top center (design `note`, shown for 1.8 s by its owner). */
export function NoticePill({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[76px] left-1/2 z-(--z-notice) flex -translate-x-1/2 items-center gap-2 rounded-full bg-t1 px-4 py-2.5 text-[14px] font-bold whitespace-nowrap text-bg shadow-popover"
    >
      <Icon name="check" weight="bold" />
      {message}
    </div>
  );
}
