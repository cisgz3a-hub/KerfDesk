import type { ExecutablePlanMotionIntent, ExecutablePlanPoint } from '../../core/execution-plan';
import type { Vec2 } from '../../core/scene';
import { mapControllerPointToScene, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  canvasPreviewMotionSequence,
  type CanvasPreviewMotion,
} from '../state/canvas-preview-motion';

export type RouteSegment = {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly intent: ExecutablePlanMotionIntent;
  /** Clipped route extent, in millimetres from job start (including Z travel). */
  readonly startRouteMm: number;
  readonly endRouteMm: number;
};

export type RouteSegmentVisitor = (segment: RouteSegment) => void;

/** Half-open motion lookup: at a cut-to-travel boundary, travel is now current. */
export function routeMotionAt(
  plan: CanvasMotionPlan,
  routeMm: number,
): CanvasPreviewMotion | undefined {
  const motions = canvasPreviewMotionSequence(plan).motions;
  const motion = motions[firstMotionEndingAfter(motions, routeMm)];
  return motion !== undefined && motion.routeStartMm <= routeMm ? motion : undefined;
}

/**
 * Walks every drawable segment intersecting `[fromRouteMm, toRouteMm)`, clipped
 * to that window and mapped into scene space.
 *
 * One walker serves both consumers of the confirmed route: the append-only
 * scorch raster (which visits each range exactly once, ever) and the live ember
 * tail (which re-visits only the short window behind the head). Sharing it keeps
 * the two from drifting apart on clipping or coordinate mapping.
 */
export function visitRouteRange(
  plan: CanvasMotionPlan,
  fromRouteMm: number,
  toRouteMm: number,
  visit: RouteSegmentVisitor,
): void {
  if (toRouteMm <= fromRouteMm) return;
  const motions = canvasPreviewMotionSequence(plan).motions;
  const first = firstMotionEndingAfter(motions, fromRouteMm);
  for (let index = first; index < motions.length; index += 1) {
    const motion = motions[index];
    if (motion === undefined || motion.routeStartMm >= toRouteMm) break;
    visitMotionRange(plan, motion, fromRouteMm, toRouteMm, visit);
  }
}

function visitMotionRange(
  plan: CanvasMotionPlan,
  motion: CanvasPreviewMotion,
  fromRouteMm: number,
  toRouteMm: number,
  visit: RouteSegmentVisitor,
): void {
  // Plunge and retract have no XY extent, so they contribute nothing drawable.
  if (motion.intent === 'plunge' || motion.intent === 'retract') return;
  let segmentStartMm = motion.routeStartMm;
  for (let index = 1; index < motion.pointsMm.length; index += 1) {
    const from = motion.pointsMm[index - 1];
    const to = motion.pointsMm[index];
    if (from === undefined || to === undefined) continue;
    const length = distance(from, to);
    const segmentEndMm = segmentStartMm + length;
    const clippedStart = Math.max(segmentStartMm, fromRouteMm);
    const clippedEnd = Math.min(segmentEndMm, toRouteMm);
    if (length > Number.EPSILON && clippedEnd > clippedStart) {
      const start = interpolate(from, to, (clippedStart - segmentStartMm) / length);
      const end = interpolate(from, to, (clippedEnd - segmentStartMm) / length);
      visit({
        from: mapControllerPointToScene(start, plan),
        to: mapControllerPointToScene(end, plan),
        intent: motion.intent,
        startRouteMm: clippedStart,
        endRouteMm: clippedEnd,
      });
    }
    segmentStartMm = segmentEndMm;
    if (segmentStartMm >= toRouteMm) break;
  }
}

/** Scratch point a {@link ScenePointMapper} writes into, so bulk walks allocate nothing. */
export type MutableScenePoint = { x: number; y: number };
export type ScenePointMapper = (x: number, y: number, out: MutableScenePoint) => void;

// Far enough from the unit probes that a non-affine mapping could not hide.
const AFFINE_PROBE = { x: 997, y: -613, z: 0 };
const AFFINE_TOLERANCE_MM = 1e-6;

/**
 * Controller-to-scene mapping for a bulk walk.
 *
 * mapControllerPointToScene allocates per point, and a raster rebuild of a
 * several-hundred-thousand-motion plan paid that for every vertex. For every
 * origin and coordinate frame the mapping is an axis flip plus an offset, so
 * its affine is derived once here and applied inline. A far probe point guards
 * the derivation; a mapping that ever stopped being affine falls back to
 * mapping each point.
 */
export function scenePointMapper(
  plan: Pick<CanvasMotionPlan, 'device' | 'coordinateFrame'>,
): ScenePointMapper {
  const origin = mapControllerPointToScene({ x: 0, y: 0, z: 0 }, plan);
  const unitX = mapControllerPointToScene({ x: 1, y: 0, z: 0 }, plan);
  const unitY = mapControllerPointToScene({ x: 0, y: 1, z: 0 }, plan);
  // Snap the linear part to the exact flip it is: bed-size subtraction leaves
  // an ulp of noise that would otherwise scale every coordinate.
  const a = snapUnit(unitX.x - origin.x);
  const b = snapUnit(unitX.y - origin.y);
  const c = snapUnit(unitY.x - origin.x);
  const d = snapUnit(unitY.y - origin.y);
  const probe = mapControllerPointToScene(AFFINE_PROBE, plan);
  const affine =
    Math.abs(a * AFFINE_PROBE.x + c * AFFINE_PROBE.y + origin.x - probe.x) <= AFFINE_TOLERANCE_MM &&
    Math.abs(b * AFFINE_PROBE.x + d * AFFINE_PROBE.y + origin.y - probe.y) <= AFFINE_TOLERANCE_MM;
  if (!affine) {
    return (x, y, out) => {
      const scene = mapControllerPointToScene({ x, y, z: 0 }, plan);
      out.x = scene.x;
      out.y = scene.y;
    };
  }
  return (x, y, out) => {
    out.x = a * x + c * y + origin.x;
    out.y = b * x + d * y + origin.y;
  };
}

/** Clipped scene-space segment; return false to stop the walk after it. */
export type RouteLineVisitor = (
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  intent: ExecutablePlanMotionIntent,
) => boolean;

const LINE_START: MutableScenePoint = { x: 0, y: 0 };
const LINE_END: MutableScenePoint = { x: 0, y: 0 };

/**
 * Allocation-free sibling of {@link visitRouteRange} for the burn raster's bulk
 * walks: the same clipping and the same route arithmetic, but endpoints arrive
 * as numbers instead of seven objects per segment.
 *
 * Returns the route position reached: `toRouteMm` when the range is exhausted,
 * or the clipped end of the segment on which the visitor stopped, which is
 * exactly where a following walk resumes without repeating a segment.
 */
export function walkRouteLines(
  plan: CanvasMotionPlan,
  fromRouteMm: number,
  toRouteMm: number,
  visit: RouteLineVisitor,
): number {
  if (toRouteMm <= fromRouteMm) return fromRouteMm;
  const motions = canvasPreviewMotionSequence(plan).motions;
  const map = scenePointMapper(plan);
  for (
    let index = firstMotionEndingAfter(motions, fromRouteMm);
    index < motions.length;
    index += 1
  ) {
    const motion = motions[index];
    if (motion === undefined || motion.routeStartMm >= toRouteMm) break;
    const stoppedAt = walkMotionLines(motion, fromRouteMm, toRouteMm, map, visit);
    if (stoppedAt !== null) return stoppedAt;
  }
  return toRouteMm;
}

function walkMotionLines(
  motion: CanvasPreviewMotion,
  fromRouteMm: number,
  toRouteMm: number,
  map: ScenePointMapper,
  visit: RouteLineVisitor,
): number | null {
  if (motion.intent === 'plunge' || motion.intent === 'retract') return null;
  let segmentStartMm = motion.routeStartMm;
  for (let index = 1; index < motion.pointsMm.length; index += 1) {
    const from = motion.pointsMm[index - 1];
    const to = motion.pointsMm[index];
    if (from === undefined || to === undefined) continue;
    const length = distance(from, to);
    const segmentEndMm = segmentStartMm + length;
    const clippedStart = Math.max(segmentStartMm, fromRouteMm);
    const clippedEnd = Math.min(segmentEndMm, toRouteMm);
    if (length > Number.EPSILON && clippedEnd > clippedStart) {
      // An unclipped end is the exact vertex, not (end - start) / length, which
      // can land an ulp short of 1: consecutive cuts must share bit-identical
      // endpoints to chain into one polyline instead of butting as fragments.
      const t1 = clippedEnd === segmentEndMm ? 1 : (clippedEnd - segmentStartMm) / length;
      mapAlong(from, to, (clippedStart - segmentStartMm) / length, map, LINE_START);
      mapAlong(from, to, t1, map, LINE_END);
      if (!visit(LINE_START.x, LINE_START.y, LINE_END.x, LINE_END.y, motion.intent)) {
        return clippedEnd;
      }
    }
    segmentStartMm = segmentEndMm;
    if (segmentStartMm >= toRouteMm) break;
  }
  return null;
}

function mapAlong(
  from: ExecutablePlanPoint,
  to: ExecutablePlanPoint,
  t: number,
  map: ScenePointMapper,
  out: MutableScenePoint,
): void {
  if (t <= 0) map(from.x, from.y, out);
  else if (t >= 1) map(to.x, to.y, out);
  else map(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, out);
}

function snapUnit(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-9 ? rounded : value;
}

function firstMotionEndingAfter(
  motions: ReadonlyArray<CanvasPreviewMotion>,
  routeMm: number,
): number {
  let low = 0;
  let high = motions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const motion = motions[middle];
    if (motion !== undefined && motion.routeEndMm > routeMm) high = middle;
    else low = middle + 1;
  }
  return low;
}

function distance(a: ExecutablePlanPoint, b: ExecutablePlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function interpolate(
  a: ExecutablePlanPoint,
  b: ExecutablePlanPoint,
  t: number,
): ExecutablePlanPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
