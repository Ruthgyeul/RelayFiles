"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { NodeProperties } from "@/contracts/nodes";
import { formatDateTime, formatLeft, formatSize } from "@/domain/format";
import { useNow } from "@/shared/hooks/useNow";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { IconButton } from "@/shared/ui/IconButton";
import { Modal } from "@/shared/ui/Modal";
import { filesApi } from "./api";
import { kindOf } from "./kind";

const TYPE_LABEL = { video: "Video", audio: "Audio", image: "Image", other: "File" } as const;

interface PropertiesDialogProps {
  nodeId: string | null;
  onClose: () => void;
  linkOf: (linkId: string) => string;
  onCopyLink: (url: string, visibility: "private" | "public") => void;
  onEditTags?: (nodeId: string) => void;
  onEditSettings?: (nodeId: string) => void;
  onZip?: (nodeId: string) => void;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Rows of the Properties table in the design's order. */
function rowsOf({ item, isRoot, location, effectiveVisibility, contains }: NodeProperties, now: number): [string, ReactNode, string?][] {
  const folder = item.type === "folder";
  const ext = /\.([^.]+)$/.exec(item.name)?.[1];
  const size = Number(item.size);
  const settings = item.settings;
  const expAt = settings.expAt ? Date.parse(settings.expAt) : null;
  return [
    ["Type", folder ? "Folder" : `${TYPE_LABEL[item.kind ?? "other"]}${ext ? ` (.${ext.toLowerCase()})` : ""}`],
    ["Location", isRoot ? "Top level of this account" : location.join(" / ")],
    ["Size", `${formatSize(size)}${folder ? "" : ` (${size.toLocaleString("en-US")} bytes)`}`],
    ...(contains ? [["Contains", `${plural(contains.files, "file")}, ${plural(contains.folders, "folder")}`] as [string, string]] : []),
    ["Created", formatDateTime(item.createdAt)],
    ["Visibility", effectiveVisibility === "public" ? "Public" : "Private", settings.visibility === "inherit" ? "inherited" : undefined],
    ["Expiry", expAt ? `${formatDateTime(expAt)} · in ${formatLeft(expAt - now)}` : settings.burn ? "After first download" : "Deleted with account"],
    ["Access", settings.access === "stream" ? "Stream only" : "Download + stream"],
    ["Password", settings.hasPassword ? "Set" : "None"],
    ["Downloads", `${item.downloads}${settings.downloadLimit ? ` of ${settings.downloadLimit}` : ""}`],
    ["ID", item.id],
  ];
}

const rowClass = "grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-card-line py-[9px] text-[13px]";

/** Properties of a file or folder (460px), loaded when opened. */
export function PropertiesDialog({ nodeId, onClose, linkOf, onCopyLink, onEditTags, onEditSettings, onZip }: PropertiesDialogProps) {
  const [data, setData] = useState<{ id: string; props: NodeProperties } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(nodeId !== null);

  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;
    filesApi
      .getProperties(nodeId)
      .then((props) => !cancelled && setData({ id: nodeId, props }))
      .catch((caught) => !cancelled && setError(caught instanceof ApiClientError ? caught.message : "Something went wrong."));
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  const props = data && data.id === nodeId ? data.props : null;
  const close = () => {
    setError(null);
    onClose();
  };
  const kind = props ? (props.isRoot ? { icon: "hard-drives" as const, color: "var(--accentIcon)" } : kindOf(props.item)) : null;
  const url = props ? linkOf(props.item.linkId) : "";

  return (
    <Modal open={nodeId !== null} onClose={close} width={460} layer="subdialog" label={props ? `Properties of ${props.item.name}` : "Properties"} className="overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-card-line px-5 py-4">
        {kind && <Icon name={kind.icon} weight={props?.item.type === "folder" && !props.isRoot ? "fill" : "regular"} size={30} style={{ color: kind.color }} />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-extrabold tracking-[.06em] text-t4">PROPERTIES</span>
          <span className="truncate text-[16px] font-bold">{props?.item.name ?? ""}</span>
        </div>
        <IconButton icon="x" label="Close" size={36} iconSize={18} onClick={close} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pt-2 pb-3.5">
        {error && <p className="text-[13px] text-danger-text">{error}</p>}
        {props &&
          rowsOf(props, now).map(([label, value, hint]) => (
            <div key={label} className={rowClass}>
              <span className="text-t4">{label}</span>
              <span className="flex flex-wrap items-center gap-1.5 font-semibold break-words text-t1">
                {value}
                {hint && <span className="rounded-[5px] bg-btn px-1.5 py-px text-[11px] font-medium text-t3">{hint}</span>}
              </span>
            </div>
          ))}
        {props && (
          <>
            <div className={rowClass}>
              <span className="text-t4">Tags</span>
              <div className="flex flex-wrap items-center gap-1">
                {props.item.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-[3px] rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-bold text-accent-text">
                    <Icon name="hash" />
                    {tag}
                  </span>
                ))}
                {onEditTags && (
                  <button type="button" onClick={() => onEditTags(props.item.id)} className="border-0 bg-transparent px-1 py-0.5 text-[12px] font-semibold text-accent-icon">
                    Edit
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 pt-3">
              <span className="text-[13px] text-t4">Link</span>
              <div className="flex gap-1.5">
                <div className="flex h-9 min-w-0 flex-1 items-center truncate rounded-[10px] border border-ctrl bg-bg px-2.5 font-mono text-[12px] text-accent-text">{url}</div>
                <button
                  type="button"
                  title="Copy link"
                  aria-label="Copy link"
                  onClick={() => onCopyLink(url, props.effectiveVisibility)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-ctrl bg-btn text-t1"
                >
                  <Icon name="copy" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {props && (onZip || onEditSettings) && (
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-card-line px-5 py-3">
          {onZip && (
            <Button size={38} icon="file-zip" className="px-3.5 text-[13px]" onClick={() => onZip(props.item.id)}>
              Download as zip
            </Button>
          )}
          {onEditSettings && (
            <Button variant="primary" size={38} icon="sliders-horizontal" className="px-3.5 text-[13px]" onClick={() => onEditSettings(props.item.id)}>
              Edit settings
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
