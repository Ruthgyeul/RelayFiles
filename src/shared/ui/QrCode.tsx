"use client";

import { useEffect, useState } from "react";

interface Drawn {
  text: string;
  path: string;
  extent: number;
}

/**
 * A QR code drawn as SVG in the browser (no request leaves the page). Always dark on white
 * whatever the theme: scanners need the contrast and the light quiet zone. The QR encoder is
 * loaded when a code is first shown, not with every page; until then the white square holds
 * its place.
 */
export function QrCode({ text, size, label }: { text: string; size: number; label: string }) {
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  useEffect(() => {
    let live = true;
    void import("@/shared/lib/qr").then(({ qrMatrix, qrPath, QR_QUIET_ZONE }) => {
      if (!live) return;
      const matrix = qrMatrix(text);
      setDrawn({ text, path: qrPath(matrix), extent: matrix.length + 2 * QR_QUIET_ZONE });
    });
    return () => {
      live = false;
    };
  }, [text]);
  // A code drawn for an earlier text is not shown for the new one.
  const ready = drawn?.text === text ? drawn : null;
  return (
    <svg
      role="img"
      aria-label={label}
      aria-busy={ready ? undefined : true}
      width={size}
      height={size}
      viewBox={ready ? `0 0 ${ready.extent} ${ready.extent}` : "0 0 1 1"}
      shapeRendering="crispEdges"
      className="block rounded-lg bg-white text-black"
    >
      {ready && <path d={ready.path} fill="currentColor" />}
    </svg>
  );
}
