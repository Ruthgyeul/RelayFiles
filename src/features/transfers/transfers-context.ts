"use client";

import { createContext, useContext } from "react";
import type { TransferItem } from "./transfer-items";
import type { TransferStatus } from "./transfer-text";
import type { UploadEntry } from "./read-drop";

/** Where an upload goes: "home" (new folder at the root), "root", or a folder id. */
export interface UploadTarget {
  ref: string;
  name: string;
}

/** A Home upload: every batch gets its own new folder and share link. */
export const HOME_TARGET: UploadTarget = { ref: "home", name: "Home" };

export interface UploadOptions {
  /** Called once the server prepared the batch, with the folder the files go to (they are still uploading). */
  onStart?: (folder: { id: string; name: string }) => void;
  /** Called when nothing was started (the server refused the batch, or every name was skipped); a toast says why. */
  onRefused?: () => void;
}

/** A download handed to the browser: what the panel shows about it. */
export interface DownloadRequest {
  url: string;
  title: string;
  files: number;
  total: number;
}

/** Several items saved into a folder the user picks (File System Access API, Chromium). */
export interface FolderDownloadRequest {
  title: string;
  items: { url: string; name: string; size: number }[];
}

export interface Transfer {
  id: string;
  direction: "up" | "down";
  title: string;
  folderId: string;
  fromHome: boolean;
  files: number;
  folders: number;
  total: number;
  done: number;
  status: TransferStatus;
  auto: boolean;
  error?: string;
  /** Time spent transferring before the current run, and when the current run started. */
  activeMs: number;
  runningSince: number | null;
  /** Per-file progress for batches of several files (the card's file list). */
  items?: TransferItem[];
}

export interface TransfersContextValue {
  transfers: Transfer[];
  panelOpen: boolean;
  panelExpanded: boolean;
  lastUpload: { folderId: string; name: string } | null;
  pickFiles: (target: UploadTarget) => void;
  pickFolder: (target: UploadTarget) => void;
  upload: (entries: UploadEntry[], target: UploadTarget, options?: UploadOptions) => void;
  download: (request: DownloadRequest) => void;
  /**
   * Saves items into a folder the user picks, with per-file progress and cancel. Must be called
   * from a click; returns false when the browser cannot (the caller then uses `download`).
   */
  downloadToFolder: (request: FolderDownloadRequest, fallback: () => void) => boolean;
  togglePause: (id: string) => void;
  remove: (id: string) => void;
  /** Cancels one file of a batch (queued or in progress); the others continue. */
  cancelItem: (id: string, key: number) => void;
  clearFinished: () => void;
  setPanel: (open: boolean, expanded?: boolean) => void;
}

export const TransfersContext = createContext<TransfersContextValue | null>(null);

export function useTransfers(): TransfersContextValue {
  const value = useContext(TransfersContext);
  if (!value) throw new Error("useTransfers must be used inside <TransfersProvider>.");
  return value;
}
