"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { formatCell, type CellValue } from "@/domain/document";
import { cn } from "@/shared/lib/cn";
import { DocumentBar } from "./DocumentBar";
import { FailedPreview, LoadingPreview, PreviewMessage } from "./PreviewMessage";
import { RowsTable } from "./TableView";
import { useFileBytes } from "./useFileBytes";

interface SheetRows {
  name: string;
  /** Cell text of the rows shown (header plus at most the row limit). */
  rows: string[][];
  columns: number;
  truncated: boolean;
}

/** read-excel-file types its cells loosely (`typeof Date`); narrow them to what it returns. */
function toCellValue(value: unknown): CellValue {
  return value instanceof Date || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function toSheetRows(name: string, data: readonly (readonly unknown[])[]): SheetRows {
  const kept = data.slice(0, DOCUMENT_PREVIEW.tableMaxRows + 1);
  return {
    name,
    rows: kept.map((row) => row.map((cell) => formatCell(toCellValue(cell)))),
    columns: kept.reduce((max, row) => Math.max(max, row.length), 0),
    truncated: data.length > kept.length,
  };
}

/** An Excel workbook (.xlsx) read in the browser: one table per sheet, with sheet tabs. */
export default function SpreadsheetView({ src, tooLarge }: { src: string; tooLarge: ReactNode }) {
  const file = useFileBytes(src);
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; sheets: SheetRows[] }>({ status: "loading" });
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (file.status !== "ready") return;
    let live = true;
    import("read-excel-file/browser")
      .then(({ default: readXlsxFile }) => readXlsxFile(file.bytes.buffer))
      .then((sheets) => {
        if (live) setState({ status: "ready", sheets: sheets.map((sheet) => toSheetRows(sheet.sheet, sheet.data)) });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [file]);

  if (file.status === "error" || state.status === "error") return <FailedPreview />;
  if (file.status === "too-large") return tooLarge;
  if (file.status === "loading" || state.status === "loading") return <LoadingPreview />;
  const sheet = state.sheets[active] ?? state.sheets[0];
  const count = state.sheets.length;
  return (
    <div className="flex size-full min-h-0 flex-col self-stretch">
      <DocumentBar details={["Excel workbook", `${count} ${count === 1 ? "sheet" : "sheets"}`]} />
      {count > 1 && (
        <div role="tablist" aria-label="Sheets" className="flex shrink-0 gap-1 overflow-x-auto border-b border-viewer-line bg-black px-2 py-1.5">
          {state.sheets.map((entry, index) => (
            <button
              key={`${index}:${entry.name}`}
              type="button"
              role="tab"
              aria-selected={entry === sheet}
              onClick={() => setActive(index)}
              className={cn(
                "h-7 shrink-0 rounded-md border-0 bg-transparent px-2.5 text-[12px] font-bold whitespace-nowrap",
                entry === sheet ? "bg-viewer-hover text-t1" : "text-t4",
              )}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
      <div tabIndex={0} aria-label="File contents" className="min-h-0 flex-1 overflow-auto bg-black">
        {!sheet || sheet.rows.length === 0 ? (
          <PreviewMessage icon="file-xls">This sheet is empty</PreviewMessage>
        ) : (
          <RowsTable rows={sheet.rows} columns={sheet.columns} truncated={sheet.truncated} />
        )}
      </div>
    </div>
  );
}
