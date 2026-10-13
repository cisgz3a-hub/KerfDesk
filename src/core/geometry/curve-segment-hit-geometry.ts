import {
  applyTransform,
  type Bounds,
  type CurveSubpath,
  type PathSegment,
  type Transform,
  type Vec2,
} from '../scene';
import { contourSegments, segmentStart } from './trim-curve-split';

type SegmentGeometry = {
  readonly segment: PathSegment;
  readonly from: Vec2;
  readonly sceneFrom: Vec2;
  readonly sceneTo: Vec2;
  readonly bounds: Bounds | null;
};

// Scene geometry and transforms are immutable. Weak keys also retain useful
// indexes when several placed copies share a curve, without retaining deleted copies.
const cache = new WeakMap<CurveSubpath, WeakMap<Transform, ReadonlyArray<SegmentGeometry>>>();

export function curveSegmentHitGeometry(
  curve: CurveSubpath,
  transform: Transform,
): ReadonlyArray<SegmentGeometry> {
  const byTransform = cache.get(curve) ?? new WeakMap<Transform, ReadonlyArray<SegmentGeometry>>();
  const existing = byTransform.get(transform);
  if (existing !== undefined) return existing;
  const contour = contourSegments(curve, curve.closed);
  const segments = contour.segments.map((segment, index) => {
    const from = segmentStart(contour, index);
    const sceneFrom = applyTransform(from, transform);
    const sceneTo = applyTransform(segment.to, transform);
    const controls =
      segment.kind === 'cubic'
        ? [applyTransform(segment.control1, transform), applyTransform(segment.control2, transform)]
        : [];
    // A cubic lies inside its control hull after any affine transform. Arcs
    // deliberately retain the existing exact-curve search without a broad phase.
    const points = [sceneFrom, sceneTo, ...controls];
    const bounds =
      segment.kind === 'elliptical-arc'
        ? null
        : {
            minX: Math.min(...points.map((point) => point.x)),
            minY: Math.min(...points.map((point) => point.y)),
            maxX: Math.max(...points.map((point) => point.x)),
            maxY: Math.max(...points.map((point) => point.y)),
          };
    return { segment, from, sceneFrom, sceneTo, bounds };
  });
  byTransform.set(transform, segments);
  cache.set(curve, byTransform);
  return segments;
}

export function segmentBoundsCanHit(bounds: Bounds | null, point: Vec2, radius: number): boolean {
  if (bounds === null) return true;
  return (
    point.x >= bounds.minX - radius &&
    point.x <= bounds.maxX + radius &&
    point.y >= bounds.minY - radius &&
    point.y <= bounds.maxY + radius
  );
}

export function nearestOnLine(
  from: Vec2,
  to: Vec2,
  target: Vec2,
): { readonly t: number; readonly point: Vec2; readonly distance: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((target.x - from.x) * dx + (target.y - from.y) * dy) / lengthSq));
  const point = { x: from.x + t * dx, y: from.y + t * dy };
  return { t, point, distance: Math.hypot(point.x - target.x, point.y - target.y) };
}
