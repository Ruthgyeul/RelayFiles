/** Keyboard shortcut reference shown in the shortcuts dialog (design `KEYS`). */
export interface ShortcutGroup {
  title: string;
  rows: { keys: string[]; description: string }[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Media viewer",
    rows: [
      { keys: ["Space", "K"], description: "Play / pause" },
      { keys: ["←", "→"], description: "Seek 5 s" },
      { keys: ["J", "L"], description: "Seek 10 s" },
      { keys: ["↑", "↓"], description: "Volume" },
      { keys: ["M"], description: "Mute" },
      { keys: ["F"], description: "Fullscreen" },
      { keys: ["N", "P"], description: "Next / previous file" },
      { keys: ["Esc"], description: "Close" },
    ],
  },
  {
    title: "File Manager",
    rows: [
      { keys: ["U"], description: "Upload files" },
      { keys: ["/"], description: "Search" },
      { keys: ["G"], description: "Grid / list view" },
      { keys: ["Ctrl", "A"], description: "Select all" },
      { keys: ["Del"], description: "Delete selected" },
      { keys: ["Backspace"], description: "Parent folder" },
    ],
  },
  {
    title: "Anywhere",
    rows: [
      { keys: ["Ctrl", "K"], description: "Search all files" },
      { keys: ["?"], description: "Show shortcuts" },
      { keys: ["Esc"], description: "Close dialogs" },
    ],
  },
];

/** True when a key event comes from a text field, where single-key shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
