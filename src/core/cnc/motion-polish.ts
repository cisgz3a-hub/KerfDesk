// Motion polish (Phase H.9, F-CNC18) — all OPT-IN so default output stays
// byte-identical to pre-H.9 jobs (the snapshot corpus pins it):
//
// * Cut direction. With an M3 (top-view clockwise) spindle, CLIMB cutting
//   keeps the material on the LEFT of travel. Circling a part's exterior
//   counter-clockwise puts the part on the left → outside-profile climb =
//   CCW; walking a hole/pocket boundary clockwise puts the material (which
//   lies outside the boundary) on the left → inside/pocket climb = CW.
//   Conventional is each mirror. Enforced by reversing closed toolpaths
//   whose shoelace orientation disagrees; open paths are left alone.
//   Direction enforcement also rotates each closed toolpath's start to the
//   midpoint of its longest segment, so entry witness marks land on a flat
//   span instead of a corner (the v1 lead-in strategy; arc leads are a
//   documented deferral).
//
// * Ramp entry. Plunges into contour passes become descents ALONG the
//   toolpath at the configured angle: the pass converts to path3d, ramping
//   over the leading span, cutting the full loop at depth, then re-cutting
//   the ramped span level (closed loops), or ramping forward from the
//   start (open paths).

import type { CncContourPass, CncGroup, CncPass, CncPath3dPass } from '../job';
import {
  isCounterClockwise,
  reversedPolyline,
  signedAreaMm2,
} from '../geometry/polyline-orientation';
import type { Vec3 } from '../geometry/vec3';
import type { CncCutDirection, CncCutType, CncMachineConfig, Polyline, Vec2 } from '../scene';

const MIN_CLOSED_POINTS = 3;
const MAX_RAMP_ANGLE_DEG = 45;

// The material side flips between outside profiles and inside/pocket work;
// engraves and on-path cuts have no defined material side.
export function enforceCutDirection(
  toolpaths: ReadonlyArray<Polyline>,
  direction: CncCutDirection,
  cutType: CncCutType,
): ReadonlyArray<Polyline> {
  const wantCcw = wantsCounterClockwise(direction, cutType);
  if (wantCcw === null) return toolpaths;
  return toolpaths.map((toolpath) => {
    if (!toolpath.closed || toolpath.points.length < MIN_CLOSED_POINTS) return toolpath;
    if (Math.abs(signedAreaMm2(toolpath.points)) === 0) return toolpath;
    const oriented =
      isCounterClockwise(toolpath) === wantCcw ? toolpath : reversedPolyline(toolpath);
    return rotateStartToLongestSegment(oriented);
  });
}

function wantsCounterClockwise(direction: CncCutDirection, cutType: CncCutType): boolean | null {
  if (cutType === 'profile-outside') return direction === 'climb';
  if (cutType === 'profile-inside' || cutType === 'pocket') return direction === 'conventional';
  return null;
}

// Entry marks land mid-span of the longest edge (v1 lead-in).
export function rotateStartToLongestSegment(toolpath: Polyline): Polyline {
  const points = toolpath.points;
  if (!toolpath.closed || points.length < MIN_CLOSED_POINTS) return toolpath;
  let longestIndex = 0;
  let longestLength = -1;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > longestLength) {
      longestLength = length;
      longestIndex = i;
    }
  }
  const a = points[longestIndex] as Vec2;
  const b = points[(longestIndex + 1) % points.length] as Vec2;
  const midpoint: Vec2 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const rotated = [
    midpoint,
    ...points.slice(longestIndex + 1),
    ...points.slice(0, longestIndex + 1),
  ];
  return { ...toolpath, points: rotated };
}

// Convert contour passes into ramped path3d descents. prevLevelZ is the Z
// the ramp starts from: the previous pass's level for stepped depth
// ladders, or 0 (stock top) for the first.
export function applyRampEntry(
  passes: ReadonlyArray<CncPass>,
  rampAngleDeg: number,
): ReadonlyArray<CncPass> {
  const angle = Math.min(Math.max(rampAngleDeg, 0.5), MAX_RAMP_ANGLE_DEG);
  const tangent = Math.tan((angle * Math.PI) / 180);
  let previousZ = 0;
  return passes.map((pass) => {
    if (pass.kind !== 'contour') return pass;
    // Contour-major ladders deepen the SAME contour step by step (ramp from
    // the previous level); a new contour starts shallow again — ramp from
    // the stock top.
    const fromZ = pass.zMm >= previousZ ? 0 : previousZ;
    const ramped = rampContour(pass, fromZ, tangent);
    previousZ = pass.zMm;
    return ramped;
  });
}

function rampContour(pass: CncContourPass, fromZ: number, tangent: number): CncPass {
  const drop = fromZ - pass.zMm;
  if (!(drop > 0) || pass.polyline.length < 2) return pass;
  const rampLengthMm = drop / tangent;
  const points: Vec3[] = [];
  appendRampSpan(points, pass, fromZ, rampLengthMm);
  // The remainder of the loop at full depth…
  for (const point of walkFrom(pass, points.length > 0)) {
    points.push({ x: point.x, y: point.y, z: pass.zMm });
  }
  // …then re-cut the ramped span level so no slope is left (closed only).
  if (pass.closed) {
    appendLevelRampSpan(points, pass, rampLengthMm);
  }
  const path: CncPath3dPass = { kind: 'path3d', points, closed: false };
  return path;
}

// Walks the pass polyline emitting the descending ramp vertices.
function appendRampSpan(
  points: Vec3[],
  pass: CncContourPass,
  fromZ: number,
  rampLengthMm: number,
): void {
  const drop = fromZ - pass.zMm;
  let travelled = 0;
  const source = pass.polyline;
  points.push({ x: (source[0] as Vec2).x, y: (source[0] as Vec2).y, z: fromZ });
  for (let i = 1; i < source.length && travelled < rampLengthMm; i += 1) {
    const a = source[i - 1] as Vec2;
    const b = source[i] as Vec2;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment === 0) continue;
    const remaining = rampLengthMm - travelled;
    if (segment >= remaining) {
      const t = remaining / segment;
      points.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: pass.zMm,
      });
      travelled = rampLengthMm;
      return;
    }
    travelled += segment;
    points.push({ x: b.x, y: b.y, z: fromZ - (travelled / rampLengthMm) * drop });
  }
  // Path shorter than the ramp: finish the descent vertically at the end
  // point (the ramp consumed the whole path).
  const last = source[source.length - 1] as Vec2;
  points.push({ x: last.x, y: last.y, z: pass.zMm });
}

// The full loop at depth, starting from the polyline's first vertex (the
// ramp already stands somewhere along the first span).
function* walkFrom(pass: CncContourPass, skipFirst: boolean): Generator<Vec2> {
  const source = pass.polyline;
  for (let i = skipFirst ? 1 : 0; i < source.length; i += 1) {
    yield source[i] as Vec2;
  }
  if (pass.closed) yield source[0] as Vec2;
}

// Re-cut the ramp span at the final depth (closed loops only).
function appendLevelRampSpan(points: Vec3[], pass: CncContourPass, rampLengthMm: number): void {
  const source = pass.polyline;
  let travelled = 0;
  for (let i = 1; i < source.length && travelled < rampLengthMm; i += 1) {
    const a = source[i - 1] as Vec2;
    const b = source[i] as Vec2;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment === 0) continue;
    const remaining = rampLengthMm - travelled;
    if (segment >= remaining) {
      const t = remaining / segment;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: pass.zMm });
      return;
    }
    travelled += segment;
    points.push({ x: b.x, y: b.y, z: pass.zMm });
  }
}

// H.9 parking parity: park fields are only present on groups when the
// operator configured a park position, so default output stays
// byte-identical to pre-H.9 jobs.
export function parkFields(
  config: CncMachineConfig,
): Pick<CncGroup, 'parkXMm' | 'parkYMm'> | Record<string, never> {
  const { parkXMm, parkYMm } = config.params;
  if (parkXMm === undefined && parkYMm === undefined) return {};
  return { parkXMm: parkXMm ?? 0, parkYMm: parkYMm ?? 0 };
}
