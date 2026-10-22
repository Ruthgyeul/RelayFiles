"use client";

import { useMemo } from "react";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { parseDelimited } from "@/domain/document";

const cell = "max-w-[320px] truncate border-r border-b border-viewer-line px-3 py-1.5 text-left";

/** A CSV or TSV file as a table: the first row is the header, rows are numbered. */
export function TableView({ text, delimiter }: { text: string; delimiter: "," | "\t" }) {
  const table = useMemo(() => parseDelimited(text, delimiter, DOCUMENT_PREVIEW.tableMaxRows), [text, delimiter]);
  const [head = [], ...body] = table.rows;
  const columns = Array.from({ length: table.columns }, (_, index) => index);
  return (
    <div className="w-max min-w-full">
      <table className="border-separate border-spacing-0 font-mono text-[12px] text-t2">
        <thead className="sticky top-0 bg-viewer-hover">
          <tr>
            <th className={`${cell} sticky left-0 bg-viewer-hover text-right text-t5`}>#</th>
            {columns.map((column) => (
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
              {columns.map((column) => (
                <td key={column} title={row[column]} className={cell}>
                  {row[column]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.truncated && <p className="m-0 px-3 py-2 text-[12px] text-t4">First {DOCUMENT_PREVIEW.tableMaxRows.toLocaleString("en-US")} rows</p>}
    </div>
  );
}
