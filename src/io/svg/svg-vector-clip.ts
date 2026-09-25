// A vector clip-path is refused because importing the artwork unclipped could
// cut what the design hides. A clip that hides nothing is accepted, such as the
// frame or artboard rectangle Figma and Illustrator wrap exported content in.
// "Hides nothing" is proved narrowly: the clip is one shape in user-space units
// whose outline is a single convex ring, and every point of the element lies
// inside it, so ignoring the clip changes nothing that is cut (ADR-358
// Amendment 1; 2026-09-25 PR audit, ART-2). Anything else is still refused.

import type { Vec2 } from '../../core/scene';
import type { SubPath } from './parse-path-d';
import { elementToSubPaths } from './shape-to-polylines';
import { applySvgMatrix, transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';
import { vectorClipTransform } from './svg-clip-presentation';
import type { SvgIdResolver } from './svg-id-resolver';
import type { SvgClipReference } from './svg-presentation';
import type { SvgStyleCascade } from './svg-stylesheet';
import { linearScaleMagnitude } from './transform-scale';

// Points this close outside an outline count as on it: float noise, far below
// anything a laser or a bit resolves.
const BOUNDARY_TOLERANCE = 1e-6;
const FULL_TURN = 2 * Math.PI;

/** True when every clip leaves all of `points` (document space) uncut. */
export function clipsKeepWholeGeometry(
  clips: ReadonlyArray<SvgClipReference>,
  points: ReadonlyArray<Vec2>,
  resolveId: SvgIdResolver,
  cascade: SvgStyleCascade,
): boolean {
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  return clips.every((clip) => {
    const outline = convexClipOutline(clip, resolveId, cascade);
    return outline !== null && points.every((point) => insideConvexOutline(outline, point));
  });
}

function convexClipOutline(
  reference: SvgClipReference,
  resolveId: SvgIdResolver,
  cascade: SvgStyleCascade,
): ReadonlyArray<Vec2> | null {
  const clip = resolveId(reference.id);
  if (clip === null || clip.tagName.toLowerCase() !== 'clippath') return null;
  // userSpaceOnUse is SVG's default; objectBoundingBox needs the element's bounds.
  if ((clip.getAttribute('clipPathUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') return null;
  const shapes = Array.from(clip.children).filter(
    (child) => !['title', 'desc'].includes(child.tagName.toLowerCase()),
  );
  const shape = shapes.length === 1 ? shapes[0] : undefined;
  if (shape === undefined) return null;
  const world = vectorClipTransform(reference, clip, shape, cascade);
  if (world === null) return null;
  const subpaths = elementToSubPaths(
    shape,
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
