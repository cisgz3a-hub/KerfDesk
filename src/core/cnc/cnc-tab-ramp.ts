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
// Where the windows go is cnc-tab-placement.ts (ADR-258 Amendment 5).
//
// Pure: no clock, no randomness, no I/O.

import type { Vec3 } from '../geometry/vec3';
import type { Polyline, Vec2 } from '../scene';
import {
  automaticTabPlan,
  manualTabPlan,
  modulo,
  pointAtDistance,
  tabLoop,
  type TabLoop,
  type TabPlan,
} from './cnc-tab-placement';

export type TabRampSettings = {
  readonly tabWidthMm: number;
  readonly tabsPerShape: number;
  readonly toolDiameterMm: number;
};

const EPS = 1e-9;

/**
 * Where the tabs of `toolpath` go, or null when tabs cannot apply: an open or
 * degenerate loop, or a non-positive tab window.
 *
 * `manualCenters` are normalized perimeter positions in [0, 1) (ADR-156
 * anchors); absent, automatic tabs are spaced evenly and kept off corners
 * (ADR-258 Amendment 5).
 */
export function tabPlanForToolpath(
  toolpath: Polyline,
  settings: TabRampSettings,
  manualCenters?: ReadonlyArray<number>,
): TabPlan | null {
  if (!toolpath.closed) return null;
  const loop = tabLoop(toolpath.points);
  if (loop === null) return null;
  // The skip length adds one tool diameter so the PHYSICAL bridge is the
  // requested width after the bit eats a radius from each side — same
  // convention as the split model it replaces (cnc-tabs.ts).
  const cutWidthMm = Math.max(0, settings.toolDiameterMm);
  const windowMm = Math.max(0, settings.tabWidthMm) + cutWidthMm;
  if (!(windowMm > EPS)) return null;
  return manualCenters === undefined
    ? automaticTabPlan(loop, settings.tabsPerShape, windowMm, cutWidthMm)
    : manualTabPlan(loop, manualCenters, windowMm, cutWidthMm);
}

/**
 * Walk `toolpath` at `cutZMm`, rising to `tabTopZMm` across each tab window.
 *
 * Returns null when tabs cannot apply — an open or degenerate loop, a
 * non-positive tab window, no tab at all, or a tab top that is not above the
 * cutting depth. The caller then keeps its ordinary contour pass. A caller that
 * already planned the loop passes `plan`, so every level cuts the same tabs.
 */
export function tabRampedPoints(
  toolpath: Polyline,
  cutZMm: number,
  tabTopZMm: number,
  settings: TabRampSettings,
  manualCenters?: ReadonlyArray<number>,
  plan: TabPlan | null = tabPlanForToolpath(toolpath, settings, manualCenters),
): ReadonlyArray<Vec3> | null {
  // The rise must be a real lift: an equal or lower tab top would emit a
  // zero-length or downward "tab", which is not a tab at all.
  if (!(tabTopZMm > cutZMm + EPS) || plan === null || !toolpath.closed) return null;
  const loop = tabLoop(toolpath.points);
  if (loop === null) return null;
  const windows = tabWindows(plan, loop.perimeter);
  if (windows.length === 0) return null;
  const stops = orderedStops(loop.cumulative, windows, loop.perimeter);
  return walkWithTabRises(loop, stops, windows, cutZMm, tabTopZMm);
}

/**
 * An open outline the bit closes, tabbed as the loop it makes (ADR-258
 * Amendment 5): `loop` is the outline marked closed. It is still cut from its
 * first point to its last, rising across each window it meets; the gap between
 * its ends, which the bit sweeps anyway, is never fed.
 */
export function tabRampedOpenPoints(
  loop: Polyline,
  cutZMm: number,
  tabTopZMm: number,
  plan: TabPlan,
): ReadonlyArray<Vec3> | null {
  if (!(tabTopZMm > cutZMm + EPS)) return null;
  const measured = tabLoop(loop.points);
  if (measured === null) return null;
  const windows = tabWindows(plan, measured.perimeter);
  if (windows.length === 0) return null;
  // closedLoopPoints drops a last point that repeats the first, so then the
  // outline runs the whole perimeter.
  const repeatsFirst = measured.points.length < loop.points.length;
  const endMm = repeatsFirst
    ? measured.perimeter
    : (measured.cumulative[measured.points.length - 1] as number);
  const stops = orderedStops(measured.cumulative, windows, measured.perimeter).filter(
    (stop) => stop < endMm - EPS,
  );
  const zAt = (from: number, to: number): number =>
    inAnyWindow(from + (to - from) / 2, windows) ? tabTopZMm : cutZMm;
  const out: Vec3[] = [];
  let previousZ: number | null = null;
  stops.forEach((stop, index) => {
    const spanZ = zAt(stop, stops[index + 1] ?? endMm);
    const xy = pointAtDistance(measured, stop);
    if (previousZ !== null && Math.abs(spanZ - previousZ) > EPS) {
      out.push({ x: xy.x, y: xy.y, z: previousZ });
    }
    out.push({ x: xy.x, y: xy.y, z: spanZ });
    previousZ = spanZ;
  });
  const end = loop.points[loop.points.length - 1] as Vec2;
  out.push({ x: end.x, y: end.y, z: previousZ ?? cutZMm });
  return out;
}

/**
 * The XY centre of every tab `tabRampedPoints` cuts on `toolpath` for the same
 * settings and `manualCenters`. Empty for an open or degenerate loop, and for a
 * loop too short for any tab, which rides the tab top whole.
 */
export function tabCenterPoints(
  toolpath: Polyline,
  settings: TabRampSettings,
  manualCenters?: ReadonlyArray<number>,
): ReadonlyArray<Vec2> {
  const plan = tabPlanForToolpath(toolpath, settings, manualCenters);
  const loop = tabLoop(toolpath.points);
  if (plan === null || loop === null) return [];
  return plan.centers.map((center) => pointAtDistance(loop, center));
}

/**
 * Tab centres for `target`, as normalized perimeter fractions: the nearest point
 * of `target` to each anchor that lies within `reachMm` of it.
 *
 * A pass whose slot runs beside a bridge another pass leaves must rise at the
 * same place, or it cuts that bridge away (ADR-140 Amendment 2). Anchors out of
 * reach are left out, so a pass never rises where no bridge stands beside it.
 */
export function tabFractionsNear(
  target: Polyline,
  anchors: ReadonlyArray<Vec2>,
  reachMm: number,
): ReadonlyArray<number> {
  if (!target.closed) return [];
  const loop = tabLoop(target.points);
  if (loop === null) return [];
  const fractions: number[] = [];
  for (const anchor of anchors) {
    const nearest = nearestOnLoop(loop.points, anchor);
    if (nearest.distance <= reachMm + EPS) fractions.push(nearest.at / loop.perimeter);
  }
  return fractions;
}

// Arc-length position along the ring of the point nearest `anchor`, and how far
// that point is from it.
function nearestOnLoop(
  points: ReadonlyArray<Vec2>,
  anchor: Vec2,
): { readonly at: number; readonly distance: number } {
  let bestDistance = Infinity;
  let bestAt = 0;
  let travelled = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] as Vec2;
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const { distance, ratio } = projectOntoSegment(anchor, a, b);
    if (distance < bestDistance - EPS) {
      bestDistance = distance;
      bestAt = travelled + ratio * span;
    }
    travelled += span;
  }
  return { at: bestAt, distance: bestDistance };
}

function projectOntoSegment(
  point: Vec2,
  a: Vec2,
  b: Vec2,
): { readonly distance: number; readonly ratio: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio =
    lengthSquared <= EPS
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const distance = Math.hypot(point.x - (a.x + dx * ratio), point.y - (a.y + dy * ratio));
  return { distance, ratio };
}

type TabWindow = { readonly start: number; readonly end: number };

// Windows in arc-length space, each normalized into [0, perimeter). A window may
// wrap past the seam (start > end); membership handles that.
function tabWindows(plan: TabPlan, perimeter: number): ReadonlyArray<TabWindow> {
  // Modulo endpoints cannot distinguish a full turn from an empty interval.
  if (plan.coversLoop) return [{ start: 0, end: perimeter }];
  const half = plan.windowMm / 2;
  return plan.centers.map((center) => ({
    start: modulo(center - half, perimeter),
    end: modulo(center + half, perimeter),
  }));
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
  loop: TabLoop,
  stops: ReadonlyArray<number>,
  windows: ReadonlyArray<TabWindow>,
  cutZMm: number,
  tabTopZMm: number,
): ReadonlyArray<Vec3> {
  const zForSpan = (index: number): number => {
    const from = stops[index] as number;
    const to = index + 1 < stops.length ? (stops[index + 1] as number) : loop.perimeter;
    const midpoint = from + (to - from) / 2;
    return inAnyWindow(midpoint, windows) ? tabTopZMm : cutZMm;
  };

  const out: Vec3[] = [];
  let previousZ = zForSpan(stops.length - 1);
  for (let index = 0; index < stops.length; index += 1) {
    const distance = stops[index] as number;
    const xy = pointAtDistance(loop, distance);
    const spanZ = zForSpan(index);
    if (Math.abs(spanZ - previousZ) > EPS) out.push({ x: xy.x, y: xy.y, z: previousZ });
    out.push({ x: xy.x, y: xy.y, z: spanZ });
    previousZ = spanZ;
  }
  // The closing travel belongs to the last span. Any seam Z transition was
  // already emitted as the same-XY pair at the beginning of the loop.
  const seam = pointAtDistance(loop, stops[0] as number);
  out.push({ x: seam.x, y: seam.y, z: previousZ });
  return out;
}
