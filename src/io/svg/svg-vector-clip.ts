// A vector clip-path is refused because importing the artwork unclipped could
// cut what the design hides. A clip that hides nothing is accepted, such as the
// frame or artboard rectangle Figma and Illustrator wrap exported content in.
// "Hides nothing" is proved narrowly: the clip is one shape in user-space units
// whose outline is a single convex ring, and every point of the element lies
// inside it, so ignoring the clip changes nothing that is cut (ADR-358
// Amendment 1; 2026-09-25 PR audit, ART-2). Anything else is still refused.

import type { Vec2 } from '../../core/scene';
import { elementToSubPaths } from './shape-to-polylines';
import { applySvgMatrix } from './svg-curve-transform';
import type { SvgIdResolver } from './svg-id-resolver';
import type { SvgClipReference } from './svg-presentation';
import { multiplySvgMatrix, parseSvgTransform } from './svg-transform-attribute';
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
): boolean {
  return clips.every((clip) => {
    const outline = convexClipOutline(clip, resolveId);
    return outline !== null && points.every((point) => insideConvexOutline(outline, point));
  });
}

function convexClipOutline(
  reference: SvgClipReference,
  resolveId: SvgIdResolver,
): ReadonlyArray<Vec2> | null {
  const clip = resolveId(reference.id);
  if (clip === null || clip.tagName.toLowerCase() !== 'clippath') return null;
  // userSpaceOnUse is SVG's default; objectBoundingBox needs the element's bounds.
  if ((clip.getAttribute('clipPathUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') return null;
  const shapes = Array.from(clip.children).filter(
    (child) => !['title', 'desc'].includes(child.tagName.toLowerCase()),
  );
  const shape = shapes.length === 1 ? shapes[0] : undefined;
  if (shape === undefined || clip.hasAttribute('clip-path') || shape.hasAttribute('clip-path'))
    return null;
  const world = multiplySvgMatrix(
    multiplySvgMatrix(reference.transform, parseSvgTransform(clip.getAttribute('transform'))),
    parseSvgTransform(shape.getAttribute('transform')),
  );
  const subpaths = elementToSubPaths(
    shape,
    linearScaleMagnitude(world.a, world.b, world.c, world.d),
  );
  const ring = subpaths.length === 1 ? subpaths[0] : undefined;
  if (ring === undefined) return null;
  const outline = withoutClosingPoint(ring.points.map((point) => applySvgMatrix(world, point)));
  return isConvexRing(outline) ? outline : null;
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
  for (let index = 0; index < outline.length; index += 1) {
    const a = at(outline, index);
    const b = at(outline, index + 1);
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (sense * cross < -BOUNDARY_TOLERANCE * Math.hypot(b.x - a.x, b.y - a.y)) return false;
  }
  return true;
}

function signedArea(outline: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = at(outline, index);
    const b = at(outline, index + 1);
    twice += a.x * b.y - b.x * a.y;
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
