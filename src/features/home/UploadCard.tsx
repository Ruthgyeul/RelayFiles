"use client";

import { useState, type DragEvent } from "react";
import { entriesFromDrop, hasFiles } from "@/features/transfers/read-drop";
import { useTransfers } from "@/features/transfers/TransfersProvider";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";

const HOME = { ref: "home", name: "Home" } as const;

/** Home "Upload files" card: every upload gets its own folder and share link. */
export function UploadCard() {
  const { pickFiles, pickFolder, upload } = useTransfers();
  const [dragging, setDragging] = useState(false);

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!hasFiles(event.dataTransfer)) return;
    upload(await entriesFromDrop(event.dataTransfer), HOME);
  };

  return (
    <section aria-label="Upload files" className="overflow-hidden rounded-2xl border border-card-line bg-card">
      <div className="flex items-center gap-3 border-b border-card-line px-5 py-[18px]">
        <span className="flex size-10 items-center justify-center rounded-[10px] bg-accent-soft">
          <Icon name="cloud-arrow-up" size={22} className="text-accent-icon" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[18px] font-bold">Upload files</span>
          <span className="text-[13px] text-t4">Each upload gets its own folder and share link</span>
        </div>
      </div>
      <div className="p-5">
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose files to upload"
          onClick={() => pickFiles(HOME)}
          onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), pickFiles(HOME))}
          onDragOver={(event) => {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => void onDrop(event)}
          className={cn(
            "flex h-[220px] cursor-pointer flex-col items-center justify-center gap-3.5 rounded-[14px] border-2 border-dashed bg-sunk px-4 text-center sm:h-[280px]",
            dragging ? "border-accent-hi" : "border-(--color-dashed)",
          )}
        >
          <span className="flex size-14 items-center justify-center rounded-[14px] bg-btn">
            <Icon name="upload-simple" size={28} className="text-t3" />
          </span>
          <span className="text-[17px] font-semibold">
            <span className="max-sm:hidden">Drag &amp; drop files or folders here</span>
            <span className="sm:hidden">Tap to choose files or folders</span>
          </span>
          <span className="text-[13px] text-t4">Video, audio, images, archives</span>
          <div className="flex flex-wrap justify-center gap-2">
            <span className="flex h-[38px] items-center gap-2 rounded-[10px] bg-accent px-[18px] text-[14px] font-bold text-on-accent">
              <Icon name="upload-simple" />
              Select files
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                pickFolder(HOME);
              }}
              className="flex h-[38px] items-center gap-2 rounded-[10px] border border-ctrl bg-btn px-4 text-[14px] font-bold text-t1"
            >
              <Icon name="folder-simple-plus" />
              Select folder
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
