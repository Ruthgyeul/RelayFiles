import type { NodeItem } from "@/contracts/nodes";
import type { MenuEntry } from "./ActionMenu";

/** Actions the File Manager can perform on an item; a missing handler hides its entry. */
export interface NodeActions {
  open?: () => void;
  preview?: () => void;
  download?: () => void;
  downloadZip?: () => void;
  share?: () => void;
  tags?: () => void;
  directLink?: () => void;
  newLink?: () => void;
  activity?: () => void;
  settings?: () => void;
  togglePause?: () => void;
  rename?: () => void;
  copy?: () => void;
  move?: () => void;
  delete?: () => void;
  properties?: () => void;
}

type Candidate = [label: string, icon: MenuEntry["icon"], action: (() => void) | undefined] | null;

/**
 * Item menu in the design's four groups (`nodeMenu`): open/download, sharing, file
 * operations, properties. Groups are separated by a line; empty groups disappear.
 */
export function buildNodeMenu(item: Pick<NodeItem, "type" | "kind" | "settings">, isRoot: boolean, isAdmin: boolean, actions: NodeActions): MenuEntry[] {
  const folder = item.type === "folder";
  const paused = item.settings.dlPaused;
  const groups: Candidate[][] = [
    [
      folder ? (isRoot ? null : ["Open", "folder-open", actions.open]) : item.kind !== "other" ? ["Preview", "eye", actions.preview] : null,
      ["Download", "download-simple", actions.download],
      folder ? null : ["Download as zip", "file-zip", actions.downloadZip],
    ],
    [
      folder ? ["Share", "share-network", actions.share] : null,
      ["Tags", "tag", actions.tags],
      ["Direct link", "link-simple", actions.directLink],
      ["New link", "arrows-clockwise", actions.newLink],
      ["Link activity", "chart-line-up", actions.activity],
      [isAdmin ? "Expiry & access" : "Sharing & access", "sliders-horizontal", actions.settings],
      isAdmin ? [paused ? "Resume downloads" : "Pause downloads", paused ? "play-circle" : "pause-circle", actions.togglePause] : null,
    ],
    [
      ["Rename", "pencil-simple", actions.rename],
      isRoot ? null : ["Copy", "copy", actions.copy],
      isRoot ? null : ["Move", "arrow-bend-up-right", actions.move],
      isRoot ? null : ["Delete", "trash", actions.delete],
    ],
    [["Properties", "info", actions.properties]],
  ];

  const entries: MenuEntry[] = [];
  for (const group of groups) {
    const available = group.filter((candidate): candidate is NonNullable<Candidate> & [string, MenuEntry["icon"], () => void] => candidate !== null && candidate[2] !== undefined);
    available.forEach(([label, icon, action], index) => {
      entries.push({ label, icon, onSelect: action, danger: label === "Delete", separator: entries.length > 0 && index === 0 });
    });
  }
  return entries;
}
