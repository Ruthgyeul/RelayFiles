import type { NodeItem } from "@/contracts/nodes";
import { fileFormatOf, type FormatIcon } from "@/domain/file-format";
import type { FilterKey } from "@/domain/tree";
import { KIND_COLOR } from "@/shared/styles/palette";
import type { IconName } from "@/shared/ui/icon/Icon";

interface KindIcon {
  icon: IconName;
  color: string;
}

/** Icon and color per item type; folders use the filled icon. */
export const KIND_ICON: Record<"folder" | NonNullable<NodeItem["kind"]>, KindIcon> = {
  folder: { icon: "folder-simple", color: KIND_COLOR.folder },
  video: { icon: "file-video", color: KIND_COLOR.video },
  audio: { icon: "file-audio", color: KIND_COLOR.audio },
  image: { icon: "file-image", color: KIND_COLOR.image },
  other: { icon: "file-zip", color: KIND_COLOR.other },
};

/** Icons of files that are not media, by format (source code, documents, archives, ...). */
export const FORMAT_ICON: Record<FormatIcon, KindIcon> = {
  generic: { icon: "file", color: KIND_COLOR.other },
  text: { icon: "file-txt", color: KIND_COLOR.text },
  markdown: { icon: "file-md", color: KIND_COLOR.text },
  code: { icon: "file-code", color: KIND_COLOR.code },
  terminal: { icon: "terminal-window", color: KIND_COLOR.code },
  json: { icon: "brackets-curly", color: KIND_COLOR.code },
  config: { icon: "file-ini", color: KIND_COLOR.code },
  html: { icon: "file-html", color: KIND_COLOR.code },
  css: { icon: "file-css", color: KIND_COLOR.code },
  js: { icon: "file-js", color: KIND_COLOR.code },
  jsx: { icon: "file-jsx", color: KIND_COLOR.code },
  ts: { icon: "file-ts", color: KIND_COLOR.code },
  tsx: { icon: "file-tsx", color: KIND_COLOR.code },
  python: { icon: "file-py", color: KIND_COLOR.code },
  sql: { icon: "file-sql", color: KIND_COLOR.code },
  c: { icon: "file-c", color: KIND_COLOR.code },
  cpp: { icon: "file-cpp", color: KIND_COLOR.code },
  csharp: { icon: "file-c-sharp", color: KIND_COLOR.code },
  rust: { icon: "file-rs", color: KIND_COLOR.code },
  vue: { icon: "file-vue", color: KIND_COLOR.code },
  table: { icon: "file-csv", color: KIND_COLOR.sheet },
  pdf: { icon: "file-pdf", color: KIND_COLOR.pdf },
  svg: { icon: "file-svg", color: KIND_COLOR.image },
  font: { icon: "text-aa", color: KIND_COLOR.text },
  archive: { icon: "file-zip", color: KIND_COLOR.archive },
  doc: { icon: "file-doc", color: KIND_COLOR.doc },
  sheet: { icon: "file-xls", color: KIND_COLOR.sheet },
  slides: { icon: "file-ppt", color: KIND_COLOR.slides },
  disc: { icon: "disc", color: KIND_COLOR.other },
  package: { icon: "package", color: KIND_COLOR.archive },
  certificate: { icon: "certificate", color: KIND_COLOR.archive },
  database: { icon: "database", color: KIND_COLOR.doc },
  book: { icon: "book", color: KIND_COLOR.doc },
  model: { icon: "cube", color: KIND_COLOR.image },
  lock: { icon: "file-lock", color: KIND_COLOR.other },
};

/** Media and folders by kind; other files by their format (name). */
export function kindOf(item: Pick<NodeItem, "type" | "kind" | "name">): KindIcon {
  if (item.type === "folder") return KIND_ICON.folder;
  if (item.kind && item.kind !== "other") return KIND_ICON[item.kind];
  return FORMAT_ICON[fileFormatOf(item.name).icon];
}

/** Filter chips in the design order with their icons and colors. */
export const FILTER_CHIPS: readonly { key: FilterKey; label: string; icon: IconName; color: string }[] = [
  { key: "all", label: "All", icon: "squares-four", color: "var(--t3)" },
  { key: "folder", label: "Folders", icon: "folder-simple", color: KIND_COLOR.folder },
  { key: "video", label: "Videos", icon: "film-strip", color: KIND_COLOR.video },
  { key: "audio", label: "Audio", icon: "music-note", color: KIND_COLOR.audio },
  { key: "image", label: "Images", icon: "image", color: KIND_COLOR.image },
  { key: "other", label: "Other", icon: "file", color: KIND_COLOR.other },
];
