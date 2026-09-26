// The exact short cut before any vector clip is intersected: a clip that
// provably hides none of an element changes nothing that is cut, so the
// element imports unchanged and keeps its native curves (ADR-358 Amendment 1).
// "Hides nothing" is proved narrowly: the clip is one shape with no nested
// clip, whose outline is a single convex ring, and every point of the element,
// including each curve's control hull, lies inside it. Everything else is
// intersected with the clip region instead (Amendment 2).

import type { Vec2 } from '../../core/scene';
import type { SubPath } from './parse-path-d';
import { elementToSubPaths } from './shape-to-polylines';
import type { ResolvedSvgClip } from './svg-clip-resolve';
import { applySvgMatrix, transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';
import { linearScaleMagnitude } from './transform-scale';

// Points this close outside an outline count as on it: float noise, far below
// anything a laser or a bit resolves.
const BOUNDARY_TOLERANCE = 1e-6;
const FULL_TURN = 2 * Math.PI;

export type ConvexClipOutline = ReadonlyArray<Vec2>;

/** True when every outline exists and leaves all of `points` (document space) uncut. */
export function outlinesKeepWholeGeometry(
  outlines: ReadonlyArray<ConvexClipOutline | null>,
  points: ReadonlyArray<Vec2>,
): boolean {
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  return outlines.every(
    (outline) => outline !== null && points.every((point) => insideConvexOutline(outline, point)),
  );
}

/** The clip's outline in document space when it is one convex ring, else null. */
export function convexClipOutline(clip: ResolvedSvgClip): ConvexClipOutline | null {
  const shape = clip.shapes.length === 1 && clip.clips.length === 0 ? clip.shapes[0] : undefined;
  if (shape === undefined || shape.clips.length > 0) return null;
  const world = shape.matrix;
  const subpaths = elementToSubPaths(
    shape.element,
    linearScaleMagnitude(world.a, world.b, world.c, world.d),
  );
  const ring = supportedClipSubpath(subpaths);
  if (ring === null) return null;
  const outline = withoutClosingPoint(ring.points.map((point) => applySvgMatrix(world, point)));
  return isConvexRing(outline) ? outline : null;
}

function supportedClipSubpath(subpaths: ReadonlyArray<SubPath>): SubPath | null {
  const ring = subpaths.length === 1 ? subpaths[0] : undefined;
  if (ring === undefined) return null;
  // Flattening can hide a concave curve between its sampled vertices. Rounded
  // rectangles, circles and ellipses yield inscribed convex polygons directly;
  // a path with native nonlinear segments needs an exact convexity proof first.
  if (ring.curve?.segments.some((segment) => segment.kind !== 'line')) return null;
  return ring;
}

/** A cubic stays within its control hull, unlike a chord-tolerance sample. */
export function vectorContainmentPoints(
  subpaths: ReadonlyArray<SubPath>,
  transform: SvgMatrix,
): ReadonlyArray<Vec2> {
  return subpaths.flatMap((subpath) => {
    const points = subpath.points.map((point) => applySvgMatrix(transform, point));
    if (subpath.curve === undefined) return points;
    // This is the same arc-to-cubic transform used for retained native output.
    const curve = transformSvgCurveSubpath(subpath.curve, transform);
    points.push(curve.start);
    for (const segment of curve.segments) {
      points.push(segment.to);
      if (segment.kind === 'cubic') points.push(segment.control1, segment.control2);
    }
    return points;
  });
}

function withoutClosingPoint(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points.at(-1);
  return points.length > 1 && first !== undefined && last !== undefined && samePoint(first, last)
    ? points.slice(0, -1)
    : points;
}

// Convex and simple: every turn has the same sense and they add up to exactly
// one full turn (a star polygon turns the same way but twice round).
function isConvexRing(outline: ReadonlyArray<Vec2>): boolean {
  if (outline.length < 3) return false;
  let sense = 0;
  let turning = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = at(outline, index);
    const b = at(outline, index + 1);
    const c = at(outline, index + 2);
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const cross = ab.x * bc.y - ab.y * bc.x;
    const dot = ab.x * bc.x + ab.y * bc.y;
    if (Math.abs(cross) <= BOUNDARY_TOLERANCE * Math.hypot(ab.x, ab.y) * Math.hypot(bc.x, bc.y)) {
      if (dot < 0) return false; // the outline doubles back on itself
      continue;
    }
    const turnSense = Math.sign(cross);
    if (sense !== 0 && turnSense !== sense) return false;
    sense = turnSense;
    turning += Math.atan2(cross, dot);
  }
  return sense !== 0 && Math.abs(Math.abs(turning) - FULL_TURN) < 1e-6;
}

function insideConvexOutline(outline: ReadonlyArray<Vec2>, point: Vec2): boolean {
  const sense = Math.sign(signedArea(outline));
  if (!Number.isFinite(sense) || sense === 0) return false;
  for (let index = 0; index < outline.length; index += 1) {
    const a = at(outline, index);
    const b = at(outline, index + 1);
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (sense * cross < -BOUNDARY_TOLERANCE * Math.hypot(b.x - a.x, b.y - a.y)) return false;
  }
  return true;
}

function signedArea(outline: ReadonlyArray<Vec2>): number {
  // Subtract one vertex first so a distant translated clip does not lose its
  // small area to cancellation between huge world-coordinate products.
  const origin = at(outline, 0);
  let twice = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = at(outline, index);
    const b = at(outline, index + 1);
    twice += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return twice / 2;
}

function at(outline: ReadonlyArray<Vec2>, index: number): Vec2 {
  const point = outline[index % outline.length];
  if (point === undefined) throw new Error('empty clip outline');
  return point;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= BOUNDARY_TOLERANCE && Math.abs(a.y - b.y) <= BOUNDARY_TOLERANCE;
}
