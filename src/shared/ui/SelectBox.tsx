import { Icon } from "./icon/Icon";

/** Row checkbox of a list with bulk actions (Shared by me, Recently deleted): 30px target, 20px box. */
export function SelectBox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onToggle} className="flex size-[30px] shrink-0 items-center justify-center border-0 bg-transparent p-0">
      <Icon name={checked ? "check-square" : "square"} weight={checked ? "fill" : "regular"} size={20} className={checked ? "text-accent-hi" : "text-t5"} />
    </button>
  );
}
