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
  /** Route position of the segment's far end, in millimetres from job start. */
  readonly endRouteMm: number;
};

export type RouteSegmentVisitor = (segment: RouteSegment) => void;

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
        endRouteMm: clippedEnd,
      });
    }
    segmentStartMm = segmentEndMm;
    if (segmentStartMm >= toRouteMm) break;
  }
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
