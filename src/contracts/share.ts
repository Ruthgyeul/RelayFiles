import { z } from "zod";
import { ID_PATTERN } from "@/domain/ids";
import { MAX_SHARE_PASSWORD_LENGTH, type BusyBadge, type ShareStatus } from "@/domain/share";
import type { NodeKind, SettingTag } from "@/domain/tree";

/** One row of a share page. */
export interface ShareItem {
  id: string;
  type: "file" | "folder";
  name: string;
  kind: NodeKind | null;
  /** Bytes (decimal string; may exceed 2^53). */
  size: string;
  /** Visible items inside a folder. */
  itemCount: number;
  busy: BusyBadge | null;
  canDownload: boolean;
}

export interface ShareCrumb {
  id: string;
  name: string;
}

/** An open share page: the folder (or file) being looked at and what is in it. */
export interface ShareView {
  /** The shared item; a direct file link shows just that file. */
  root: { id: string; type: "file" | "folder"; kind: NodeKind | null; createdAt: string };
  folder: { id: string; name: string; parentId: string | null };
  crumbs: ShareCrumb[];
  /** Visible items in this folder and their total size. */
  count: number;
  size: string;
  tags: SettingTag[];
  /** The owner's note, shown on the top folder only. */
  note: string | null;
  /** False for stream-only links. */
  downloadsAllowed: boolean;
  /** "Download all" state (busy badge of the folder). */
  folderBusy: BusyBadge | null;
  items: ShareItem[];
}

export interface SharePage {
  linkId: string;
  /** Full link, e.g. https://files.example.com/d/abc. */
  url: string;
  status: ShareStatus;
  /** Name shown on the password card. */
  name: string;
  /** Set when the viewer owns the link: shows the visitor preview bar. */
  owner: { nodeId: string; folderId: string; isRootFolder: boolean } | null;
  view: ShareView | null;
}

export const unlockSchema = z.object({ password: z.string().min(1).max(MAX_SHARE_PASSWORD_LENGTH) });

export const linkIdSchema = z.string().regex(ID_PATTERN.link);
