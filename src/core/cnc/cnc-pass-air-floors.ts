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
// paths or the covering test fails. The claim holds on the path, not over a
// region: a cusp a wide stepover leaves between two rings is off both paths.

import {
  circularArcGeometry,
  isCircularArcFullCircle,
  sampleCircularArcPoints,
  type CircularArc2d,
} from '../geometry/circular-arc';
import type { CncArcPass, CncPass } from '../job';
import { cncHelicalContourCanEmit } from '../job/helical-representation';
import type { Vec2 } from '../scene';
import { cncContourEmissionPrecision } from './cnc-contour-emission';
import { formatCncCoordinateMm } from './cnc-output-precision';

/** How far a point may lie off an earlier path and still be on it. The
 *  producers reuse the same coordinates for every depth; this absorbs the
 *  rounding of points a ramp interpolates along a segment. */
const ON_PATH_MM = 1e-6;

// A circular move the bit's centre followed (G2/G3), counter-clockwise from
// `fromRad` through `sweepRad` (0 to a full turn).
type Arc = {
  readonly center: Vec2;
  readonly radius: number;
  readonly fromRad: number;
  readonly sweepRad: number;
};

// Where a pass's bit centre went: straight moves along `points`, and `arcs`.
// Only these count as cut; the chords of an arc do not, since G2/G3 moves
// follow the circle itself.
type Trace = {
  readonly points: ReadonlyArray<Vec2>;
  readonly arcs: ReadonlyArray<Arc>;
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
      if (cncContourEmissionPrecision(pass) === null) return null;
      return trace(closedPoints(pass.polyline, pass.closed), [], pass.zMm);
    case 'path3d':
      if (pass.points.length < 2) return null;
      return trace(
        pass.points,
        [],
        pass.points.reduce((high, point) => Math.max(high, point.z), Number.NEGATIVE_INFINITY),
      );
    case 'arc':
      return arcTrace(pass);
    case 'helical-contour': {
      if (!cncHelicalContourCanEmit(pass)) return null;
      // Only ever an earlier cut: the helix circle, then its ring.
      const circle = arcOf({ ...pass, end: pass.start });
      return trace(
        closedPoints(pass.polyline, pass.closed),
        circle === null ? [] : [circle],
        Math.max(pass.startZMm, pass.zMm),
      );
    }
  }
}

function arcTrace(pass: CncArcPass): Trace | null {
  // Match the emitter's fallback when distinct endpoints round together.
  const arc = arcOf(pass);
  const endpointsMatch =
    formatCncCoordinateMm(pass.start.x) === formatCncCoordinateMm(pass.end.x) &&
    formatCncCoordinateMm(pass.start.y) === formatCncCoordinateMm(pass.end.y);
  return arc === null || (endpointsMatch && !isCircularArcFullCircle(pass))
    ? trace(closedPoints(sampleCircularArcPoints(pass), pass.closed), [], pass.zMm)
    : trace([], [arc], pass.zMm);
}

function closedPoints(points: ReadonlyArray<Vec2>, closed: boolean): ReadonlyArray<Vec2> {
  const first = points[0];
  return closed && first !== undefined ? [...points, first] : points;
}

function arcOf(arc: CircularArc2d): Arc | null {
  const geometry = circularArcGeometry(arc);
  if (geometry.kind === 'invalid') return null;
  const { radiusMm, startRad, sweepRad } = geometry;
  return {
    center: arc.center,
    radius: radiusMm,
    fromRad: sweepRad < 0 ? startRad + sweepRad : startRad,
    sweepRad: Math.abs(sweepRad),
  };
}

function trace(
  points: ReadonlyArray<Vec2>,
  arcs: ReadonlyArray<Arc>,
  highestZ: number,
): Trace | null {
  if ((points.length < 2 && arcs.length === 0) || !Number.isFinite(highestZ)) return null;
  // An arc's box is its whole circle's: a looser box only filters less.
  const corners = arcs.flatMap(({ center, radius }) => [
    { x: center.x - radius, y: center.y - radius },
    { x: center.x + radius, y: center.y + radius },
  ]);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of [...points, ...corners]) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { points, arcs, highestZ, minX, minY, maxX, maxY };
}

function boxContains(outer: Trace, inner: Trace): boolean {
  return (
    inner.minX >= outer.minX - ON_PATH_MM &&
    inner.minY >= outer.minY - ON_PATH_MM &&
    inner.maxX <= outer.maxX + ON_PATH_MM &&
    inner.maxY <= outer.maxY + ON_PATH_MM
  );
}

/** Every move of `inner` lies on `outer`'s path: a straight move on its
 *  straight moves, an arc on one of its arcs. A straight move never lies on
 *  an arc, except a Z-only one at a point of it. */
function covers(outer: Trace, inner: Trace): boolean {
  if (!inner.arcs.every((arc) => outer.arcs.some((path) => arcContains(path, arc)))) {
    return false;
  }
  // Depth passes normally reuse every vertex. Prove that common case in
  // linear time instead of comparing every segment with every earlier one.
  if (
    outer.points.length === inner.points.length &&
    inner.points.every((point, index) => {
      const previous = outer.points[index];
      return previous !== undefined && point.x === previous.x && point.y === previous.y;
    })
  )
    return true;
  for (let index = 1; index < inner.points.length; index += 1) {
    const a = inner.points[index - 1];
    const b = inner.points[index];
    if (a === undefined || b === undefined) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= ON_PATH_MM) {
      if (!pointOnPath(a, outer.points) && !outer.arcs.some((arc) => pointOnArc(arc, a))) {
        return false;
      }
    } else if (!segmentCovered(a, b, outer.points)) {
      return false;
    }
  }
  return true;
}

function pointOnArc(arc: Arc, point: Vec2): boolean {
  const dx = point.x - arc.center.x;
  const dy = point.y - arc.center.y;
  if (Math.abs(Math.hypot(dx, dy) - arc.radius) > ON_PATH_MM) return false;
  return turnFrom(arc.fromRad, Math.atan2(dy, dx)) <= arc.sweepRad + ON_PATH_MM / arc.radius;
}

// `inner` runs round the same circle as `outer`, within its sweep.
function arcContains(outer: Arc, inner: Arc): boolean {
  if (distance(outer.center, inner.center) > ON_PATH_MM) return false;
  if (Math.abs(outer.radius - inner.radius) > ON_PATH_MM) return false;
  const slack = ON_PATH_MM / outer.radius;
  if (outer.sweepRad >= 2 * Math.PI - slack) return true;
  return turnFrom(outer.fromRad, inner.fromRad) + inner.sweepRad <= outer.sweepRad + slack;
}

/** The counter-clockwise turn from one angle to another, in [0, 2π). */
function turnFrom(fromRad: number, toRad: number): number {
  const turn = (toRad - fromRad) % (2 * Math.PI);
  return turn < 0 ? turn + 2 * Math.PI : turn;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The segment a->b is covered when the outer path's segments that lie on the
// line through a and b span all of it, from a to b, without a gap.
function segmentCovered(a: Vec2, b: Vec2, path: ReadonlyArray<Vec2>): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
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
