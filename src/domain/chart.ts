/**
 * Line chart geometry. Values are percentages of the chart height (0–100, null = no data);
 * points live in a 100×100 box with y measured from the bottom, so callers can place SVG
 * paths (viewBox `0 0 100 100`) and HTML markers (`left` / `bottom` in %) on the same grid.
 */

/** Size of the square chart box (percent). */
export const CHART_SCALE = 100;
/** Decimals kept in path coordinates (sub-pixel precision without long strings). */
const COORD_DECIMALS = 2;
const HALF_SLOT = 0.5;

export interface ChartPoint {
  /** Center of the point's slot, 0–100 from the left. */
  x: number;
  /** 0–100 from the bottom. */
  y: number;
}

const round = (value: number) => Number(value.toFixed(COORD_DECIMALS));
const clamp = (value: number) => Math.min(CHART_SCALE, Math.max(0, value));

/** Horizontal center of slot `index` out of `count` equal slots. */
export function slotCenter(index: number, count: number): number {
  return count > 0 ? round(((index + HALF_SLOT) / count) * CHART_SCALE) : 0;
}

/** Splits a series into runs of consecutive values; null slots become gaps in the line. */
export function lineSegments(values: (number | null)[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: slotCenter(index, values.length), y: round(clamp(value)) });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

const svgY = (point: ChartPoint) => round(CHART_SCALE - point.y);

/** SVG path through the points (viewBox `0 0 100 100`, y flipped to SVG's top-down axis). */
export function linePath(points: ChartPoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${svgY(point)}`).join(" ");
}

/** The line path closed down to the baseline, for the filled area under the line. */
export function areaPath(points: ChartPoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  return `${linePath(points)} L${last.x} ${CHART_SCALE} L${first.x} ${CHART_SCALE} Z`;
}
