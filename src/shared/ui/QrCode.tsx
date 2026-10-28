import { useMemo } from "react";
import { qrMatrix, qrPath, QR_QUIET_ZONE } from "@/shared/lib/qr";

/**
 * A QR code drawn as SVG in the browser (no request leaves the page). Always dark on white
 * whatever the theme: scanners need the contrast and the light quiet zone.
 */
export function QrCode({ text, size, label }: { text: string; size: number; label: string }) {
  const { path, extent } = useMemo(() => {
    const matrix = qrMatrix(text);
    return { path: qrPath(matrix), extent: matrix.length + 2 * QR_QUIET_ZONE };
  }, [text]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${extent} ${extent}`} shapeRendering="crispEdges" className="block rounded-lg bg-white text-black">
      <path d={path} fill="currentColor" />
    </svg>
  );
}
