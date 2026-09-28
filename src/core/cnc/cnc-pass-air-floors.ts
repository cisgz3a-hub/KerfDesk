// Air floors for 2D passes (CNC gap audit CW-02): a depth pass that runs over
// the path an earlier pass of its group already cut is rapided down to just
// above that cut instead of fed down from safe Z (ADR-489's descent).
//
// The proof is the ADR-489 claim, from the group's own earlier cuts. One
// group cuts with one bit. Where that bit's tip passed an XY point at height
// z, no stock is left above the bit's own shape there, so the same bit at that
// XY with its tip at z or higher touches nothing. A pass whose every segment
// lies on an earlier pass's path therefore clears stock at that pass's highest
// Z anywhere along it, and that height is its floor. A pass with no such
// earlier pass (the first depth, or a path no earlier pass traced) keeps its
// plunge from safe Z. Leads, tabs and ramps need no special case: a tab or a
// ramp only raises the earlier pass's highest Z, and a lead is part of both
// paths or the covering test fails.

import { sampleCircularArcPoints } from '../geometry/circular-arc';
import type { CncPass } from '../job';
import type { Vec2 } from '../scene';

/** How far a point may lie off an earlier path and still be on it. The
 *  producers reuse the same coordinates for every depth; this absorbs the
 *  rounding of points a ramp interpolates along a segment. */
const ON_PATH_MM = 1e-6;

type Trace = {
  readonly points: ReadonlyArray<Vec2>;
  readonly highestZ: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function withPassAirFloors(passes: ReadonlyArray<CncPass>): ReadonlyArray<CncPass> {
  const cut: Trace[] = [];
  let changed = false;
  const out = passes.map((pass) => {
    const trace = traceOf(pass);
    const floored = trace === null ? pass : withFloor(pass, trace, cut);
    if (trace !== null) cut.push(trace);
    if (floored !== pass) changed = true;
    return floored;
  });
  return changed ? out : passes;
}

function withFloor(pass: CncPass, trace: Trace, cut: ReadonlyArray<Trace>): CncPass {
  if (pass.kind === 'helical-contour' || pass.airFloorZMm !== undefined) return pass;
  // Linked passes are reached at depth (ADR-491): nothing descends into them.
  if (pass.kind === 'contour' && pass.stayDownEntry === true) return pass;
  if (pass.kind === 'path3d' && pass.stayDownLink === true) return pass;
  let floor = Number.POSITIVE_INFINITY;
  for (const earlier of cut) {
    if (earlier.highestZ < floor && boxContains(earlier, trace) && covers(earlier, trace)) {
      floor = earlier.highestZ;
    }
  }
  return Number.isFinite(floor) ? { ...pass, airFloorZMm: floor } : pass;
}

function traceOf(pass: CncPass): Trace | null {
  switch (pass.kind) {
    case 'contour':
      return trace(closedPoints(pass.polyline, pass.closed), pass.zMm);
    case 'path3d':
      return trace(
        pass.points,
        pass.points.reduce((high, point) => Math.max(high, point.z), Number.NEGATIVE_INFINITY),
      );
    case 'arc':
      return trace(sampleCircularArcPoints(pass), pass.zMm);
    case 'helical-contour':
      // Only ever an earlier cut: the helix circle, then its ring.
      return trace(
        [...sampleHelixCircle(pass), ...closedPoints(pass.polyline, pass.closed)],
        pass.startZMm,
      );
  }
}

function closedPoints(points: ReadonlyArray<Vec2>, closed: boolean): ReadonlyArray<Vec2> {
  const first = points[0];
  return closed && first !== undefined ? [...points, first] : points;
}

function sampleHelixCircle(pass: Extract<CncPass, { kind: 'helical-contour' }>): Vec2[] {
  return sampleCircularArcPoints({
    start: pass.start,
    end: pass.start,
    center: pass.center,
    clockwise: pass.clockwise,
  });
}

function trace(points: ReadonlyArray<Vec2>, highestZ: number): Trace | null {
  if (points.length < 2 || !Number.isFinite(highestZ)) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { points, highestZ, minX, minY, maxX, maxY };
}

function boxContains(outer: Trace, inner: Trace): boolean {
  return (
    inner.minX >= outer.minX - ON_PATH_MM &&
    inner.minY >= outer.minY - ON_PATH_MM &&
    inner.maxX <= outer.maxX + ON_PATH_MM &&
    inner.maxY <= outer.maxY + ON_PATH_MM
  );
}

/** Every segment of `inner` lies on `outer`'s path. */
function covers(outer: Trace, inner: Trace): boolean {
  for (let index = 1; index < inner.points.length; index += 1) {
    const a = inner.points[index - 1];
    const b = inner.points[index];
    if (a === undefined || b === undefined) continue;
    if (!segmentCovered(a, b, outer.points)) return false;
  }
  return true;
}

// The segment a->b is covered when the outer path's segments that lie on the
// line through a and b span all of it, from a to b, without a gap.
function segmentCovered(a: Vec2, b: Vec2, path: ReadonlyArray<Vec2>): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= ON_PATH_MM) return pointOnPath(a, path);
  const spans: Array<readonly [number, number]> = [];
  for (let index = 1; index < path.length; index += 1) {
    const c = path[index - 1];
    const d = path[index];
    if (c === undefined || d === undefined) continue;
    if (offLine(c, a, dx, dy, length) || offLine(d, a, dx, dy, length)) continue;
    const tc = ((c.x - a.x) * dx + (c.y - a.y) * dy) / (length * length);
    const td = ((d.x - a.x) * dx + (d.y - a.y) * dy) / (length * length);
    spans.push(tc < td ? [tc, td] : [td, tc]);
  }
  spans.sort((left, right) => left[0] - right[0]);
  const slack = ON_PATH_MM / length;
  let reach = 0;
  for (const [start, end] of spans) {
    if (start > reach + slack) return false;
    reach = Math.max(reach, end);
    if (reach >= 1 - slack) return true;
  }
  return false;
}

// A Z-only move (a drill peck) stays at one XY, which must be on the path.
function pointOnPath(point: Vec2, path: ReadonlyArray<Vec2>): boolean {
  if (path.length === 1) return distanceToSegment(point, path[0], path[0]) <= ON_PATH_MM;
  for (let index = 1; index < path.length; index += 1) {
    if (distanceToSegment(point, path[index - 1], path[index]) <= ON_PATH_MM) return true;
  }
  return false;
}

function distanceToSegment(point: Vec2, c: Vec2 | undefined, d: Vec2 | undefined): number {
  if (c === undefined || d === undefined) return Number.POSITIVE_INFINITY;
  const dx = d.x - c.x;
  const dy = d.y - c.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - c.x) * dx + (point.y - c.y) * dy) / length2));
  return Math.hypot(point.x - (c.x + t * dx), point.y - (c.y + t * dy));
}

function offLine(point: Vec2, a: Vec2, dx: number, dy: number, length: number): boolean {
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length > ON_PATH_MM;
}
