"use client";

import { useMemo } from "react";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { parseDelimited } from "@/domain/document";

const cell = "max-w-[320px] truncate border-r border-b border-viewer-line px-3 py-1.5 text-left";

interface RowsTableProps {
  /** Cell text; the first row is the header. */
  rows: readonly (readonly string[])[];
  /** Widest row (rows may have fewer cells). */
  columns: number;
  /** More rows followed than are shown. */
  truncated: boolean;
}

/** Rows as a table with a sticky header and row numbers, cut to the preview's row and column limits. */
export function RowsTable({ rows, columns, truncated }: RowsTableProps) {
  const [head = [], ...body] = rows.slice(0, DOCUMENT_PREVIEW.tableMaxRows + 1);
  const shownColumns = Array.from({ length: Math.min(columns, DOCUMENT_PREVIEW.tableMaxColumns) }, (_, index) => index);
  const notes = [
    truncated || rows.length > DOCUMENT_PREVIEW.tableMaxRows + 1 ? `First ${DOCUMENT_PREVIEW.tableMaxRows.toLocaleString("en-US")} rows` : null,
    columns > DOCUMENT_PREVIEW.tableMaxColumns ? `First ${DOCUMENT_PREVIEW.tableMaxColumns} columns` : null,
  ].filter((note) => note !== null);
  return (
    <div className="w-max min-w-full">
      <table className="border-separate border-spacing-0 font-mono text-[12px] text-t2">
        <thead className="sticky top-0 bg-viewer-hover">
          <tr>
            <th className={`${cell} sticky left-0 bg-viewer-hover text-right text-t5`}>#</th>
            {shownColumns.map((column) => (
              <th key={column} title={head[column]} className={`${cell} font-bold text-t1`}>
                {head[column]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index}>
              <td className={`${cell} sticky left-0 bg-black text-right text-t5`}>{index + 1}</td>
              {shownColumns.map((column) => (
                <td key={column} title={row[column]} className={cell}>
                  {row[column]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length > 0 && <p className="m-0 px-3 py-2 text-[12px] text-t4">{notes.join(" · ")}</p>}
    </div>
  );
}

/** A CSV or TSV file as a table. */
export function TableView({ text, delimiter }: { text: string; delimiter: "," | "\t" }) {
  const table = useMemo(() => parseDelimited(text, delimiter, DOCUMENT_PREVIEW.tableMaxRows + 1), [text, delimiter]);
  return <RowsTable rows={table.rows} columns={table.columns} truncated={table.truncated} />;
}
