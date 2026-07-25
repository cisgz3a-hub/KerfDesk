// Holding tabs as a Z-rise in ONE continuous toolpath (ADR-258).
//
// A tabbed deep pass keeps the whole loop and lifts the cutter to the tab top
// across each tab window, instead of splitting the loop into pieces that each
// need their own retract / rapid / full-depth plunge. The cutter never leaves
// the cut, so:
//
//   * no full-depth plunge lands on the finished wall (the split model made one
//     per piece, per pass);
//   * the pass stays a single entry, so ADR-250 lead-in/out still applies — the
//     split model had to disable leads outright;
//   * a contour whose perimeter is shorter than the total tab window can no
//     longer lose its deep pass entirely. It simply rides at the tab top.
//
// This is the model Fusion 360 documents ("the tool goes up in places where tabs
// are located, leaving a thin layer of material") and matches its Rectangular
// tab shape. Triangular / ramped tab walls are a deliberate follow-up: the
// rectangular form needs no feed policy of its own because the emitter already
// sends a pure-vertical segment at the plunge feed
// (cnc-grbl-strategy.ts appendPath3dCutMoves).
//
// Pure: no clock, no randomness, no I/O.

import type { Vec3 } from '../geometry/vec3';
import type { Polyline, Vec2 } from '../scene';

export type TabRampSettings = {
  readonly tabWidthMm: number;
  readonly tabsPerShape: number;
  readonly toolDiameterMm: number;
};

const EPS = 1e-9;

/**
 * Walk `toolpath` at `cutZMm`, rising to `tabTopZMm` across each tab window.
 *
 * Returns null when tabs cannot apply — an open or degenerate loop, a
 * non-positive tab window, or a tab top that is not above the cutting depth.
 * The caller then keeps its ordinary contour pass.
 *
 * `manualCenters` are normalized perimeter positions in [0, 1) (ADR-156 anchors);
 * absent, tab centers are spaced evenly the way `automaticTabAnchorPoints` does.
 */
export function tabRampedPoints(
  toolpath: Polyline,
  cutZMm: number,
  tabTopZMm: number,
  settings: TabRampSettings,
  manualCenters?: ReadonlyArray<number>,
): ReadonlyArray<Vec3> | null {
  if (!toolpath.closed) return null;
  // The rise must be a real lift: an equal or lower tab top would emit a
  // zero-length or downward "tab", which is not a tab at all.
  if (!(tabTopZMm > cutZMm + EPS)) return null;
  const points = closedLoopPoints(toolpath.points);
  if (points.length < 3) return null;
  const cumulative = cumulativeDistances(points);
  const perimeter = cumulative[cumulative.length - 1] ?? 0;
  if (!(perimeter > EPS)) return null;
  // The skip length adds one tool diameter so the PHYSICAL bridge is the
  // requested width after the bit eats a radius from each side — same
  // convention as the split model it replaces (cnc-tabs.ts).
  const windowMm = Math.max(0, settings.tabWidthMm) + Math.max(0, settings.toolDiameterMm);
  if (!(windowMm > EPS)) return null;
  const windows = tabWindows(perimeter, windowMm, settings.tabsPerShape, manualCenters);
  if (windows.length === 0) return null;

  const stops = orderedStops(cumulative, windows, perimeter);
  return walkWithTabRises(points, cumulative, perimeter, stops, windows, cutZMm, tabTopZMm);
}

type TabWindow = { readonly start: number; readonly end: number };

// Windows in arc-length space, each normalized into [0, perimeter). A window may
// wrap past the seam (start > end); membership handles that.
function tabWindows(
  perimeter: number,
  windowMm: number,
  tabsPerShape: number,
  manualCenters?: ReadonlyArray<number>,
): ReadonlyArray<TabWindow> {
  const half = windowMm / 2;
  const centers = tabCenters(perimeter, tabsPerShape, manualCenters);
  return centers.map((center) => ({
    start: modulo(center - half, perimeter),
    end: modulo(center + half, perimeter),
  }));
}

function tabCenters(
  perimeter: number,
  tabsPerShape: number,
  manualCenters?: ReadonlyArray<number>,
): ReadonlyArray<number> {
  if (manualCenters !== undefined) {
    return manualCenters
      .filter((fraction) => Number.isFinite(fraction))
      .map((fraction) => modulo(fraction, 1) * perimeter);
  }
  const count = Math.max(1, Math.floor(tabsPerShape));
  const centers: number[] = [];
  for (let index = 0; index < count; index += 1) {
    centers.push(((index + 0.5) * perimeter) / count);
  }
  return centers;
}

function inAnyWindow(distance: number, windows: ReadonlyArray<TabWindow>): boolean {
  return windows.some(({ start, end }) =>
    start <= end
      ? distance >= start - EPS && distance <= end + EPS
      : distance >= start - EPS || distance <= end + EPS,
  );
}

// Every original vertex plus every window edge, deduped and sorted. Between two
// consecutive stops the in-window state cannot change, so each span has one Z.
function orderedStops(
  cumulative: ReadonlyArray<number>,
  windows: ReadonlyArray<TabWindow>,
  perimeter: number,
): ReadonlyArray<number> {
  const raw: number[] = [0];
  for (let index = 0; index < cumulative.length - 1; index += 1) {
    raw.push(cumulative[index] as number);
  }
  for (const { start, end } of windows) {
    raw.push(start, end);
  }
  const sorted = raw.map((value) => modulo(value, perimeter)).sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of sorted) {
    const last = unique[unique.length - 1];
    if (last === undefined || value - last > EPS) unique.push(value);
  }
  return unique;
}

// Emit one Vec3 per stop, inserting a second vertex at the same XY whenever the
// span's Z changes — that same-XY pair is what the emitter turns into a vertical
// plunge-feed move, giving a rectangular tab wall.
function walkWithTabRises(
  points: ReadonlyArray<Vec2>,
  cumulative: ReadonlyArray<number>,
  perimeter: number,
  stops: ReadonlyArray<number>,
  windows: ReadonlyArray<TabWindow>,
  cutZMm: number,
  tabTopZMm: number,
): ReadonlyArray<Vec3> {
  const zForSpan = (index: number): number => {
    const from = stops[index] as number;
    const to = index + 1 < stops.length ? (stops[index + 1] as number) : perimeter;
    const midpoint = from + (to - from) / 2;
    return inAnyWindow(midpoint, windows) ? tabTopZMm : cutZMm;
  };

  const out: Vec3[] = [];
  let previousZ = zForSpan(stops.length - 1);
  for (let index = 0; index < stops.length; index += 1) {
    const distance = stops[index] as number;
    const xy = pointAtDistance(points, cumulative, perimeter, distance);
    const spanZ = zForSpan(index);
    if (Math.abs(spanZ - previousZ) > EPS) out.push({ x: xy.x, y: xy.y, z: previousZ });
    out.push({ x: xy.x, y: xy.y, z: spanZ });
    previousZ = spanZ;
  }
  // Close the loop back to the seam at the Z the first span runs at.
  const seam = pointAtDistance(points, cumulative, perimeter, stops[0] as number);
  out.push({ x: seam.x, y: seam.y, z: zForSpan(0) });
  return out;
}

// Drop a trailing vertex that repeats the first: callers hand us rings both with
// and without the explicit closing point.
function closedLoopPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  if (points.length < 2) return points;
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  const repeatsFirst = Math.abs(first.x - last.x) <= EPS && Math.abs(first.y - last.y) <= EPS;
  return repeatsFirst ? points.slice(0, -1) : points;
}

// Cumulative arc length around the closed ring; the final entry is the perimeter
// (back to the seam).
function cumulativeDistances(points: ReadonlyArray<Vec2>): ReadonlyArray<number> {
  const out: number[] = [0];
  for (let index = 1; index <= points.length; index += 1) {
    const previous = points[index - 1] as Vec2;
    const current = points[index % points.length] as Vec2;
    const step = Math.hypot(current.x - previous.x, current.y - previous.y);
    out.push((out[index - 1] as number) + step);
  }
  return out;
}

function pointAtDistance(
  points: ReadonlyArray<Vec2>,
  cumulative: ReadonlyArray<number>,
  perimeter: number,
  distance: number,
): Vec2 {
  const target = modulo(distance, perimeter);
  for (let index = 1; index < cumulative.length; index += 1) {
    const from = cumulative[index - 1] as number;
    const to = cumulative[index] as number;
    if (target > to + EPS) continue;
    const span = to - from;
    const ratio = span <= EPS ? 0 : (target - from) / span;
    const a = points[index - 1] as Vec2;
    const b = points[index % points.length] as Vec2;
    return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
  }
  return points[0] as Vec2;
}

function modulo(value: number, divisor: number): number {
  if (!(divisor > 0)) return 0;
  return ((value % divisor) + divisor) % divisor;
}
