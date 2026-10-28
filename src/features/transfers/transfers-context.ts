"use client";

import { createContext, useContext } from "react";
import type { TransferStatus } from "./transfer-text";
import type { UploadEntry } from "./read-drop";

/** Where an upload goes: "home" (new folder at the root), "root", or a folder id. */
export interface UploadTarget {
  ref: string;
  name: string;
}

/** A download handed to the browser: what the panel shows about it. */
export interface DownloadRequest {
  url: string;
  title: string;
  files: number;
  total: number;
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
}

export interface TransfersContextValue {
  transfers: Transfer[];
  panelOpen: boolean;
  panelExpanded: boolean;
  lastUpload: { folderId: string; name: string } | null;
  pickFiles: (target: UploadTarget) => void;
  pickFolder: (target: UploadTarget) => void;
  upload: (entries: UploadEntry[], target: UploadTarget) => void;
  download: (request: DownloadRequest) => void;
  togglePause: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setPanel: (open: boolean, expanded?: boolean) => void;
}

export const TransfersContext = createContext<TransfersContextValue | null>(null);

export function useTransfers(): TransfersContextValue {
  const value = useContext(TransfersContext);
  if (!value) throw new Error("useTransfers must be used inside <TransfersProvider>.");
  return value;
}
