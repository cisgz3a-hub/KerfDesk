// Segment hit-testing for the node editor (ADR-376): which segment of the
// edited artwork is under the pointer, and where along it. The pointer is
// matched against a cached sampling of each subpath, then the parameter is
// refined on the exact curve, so inserting a node at the cursor lands where
// the operator pointed at any zoom.

import {
  applyTransform,
  sceneLayerVisibility,
  type ColoredPath,
  type CurveSubpath,
  type Layer,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import {
  explicitCurveSubpath,
  pointOnSegment,
  sampleSegment,
  segmentStartPoint,
  type SegmentSample,
} from '../../core/geometry/curve-segment-geometry';
import { canonicalCurves } from '../state/path-curve-object-edit';
import type { PathSegmentRef } from '../state/path-segment-ref';

export const PATH_SEGMENT_HIT_RADIUS_PX = 6;

export type PathSegmentHit = {
  readonly ref: PathSegmentRef;
  /** Parameter along the explicit segment (0 at its start node). */
  readonly t: number;
  /** Scene point on the segment nearest the pointer. */
  readonly point: Vec2;
  readonly distanceMm: number;
};

export type SampledSubpath = {
  /** Explicit form: segment i runs from node i to node i + 1. */
  readonly subpath: CurveSubpath;
  readonly segments: ReadonlyArray<ReadonlyArray<SegmentSample>>;
  /** How far, in local units, the samples' chords may stray from the curve. */
  readonly tolerance: number;
};

type CoarseHit = {
  readonly segmentIndex: number;
  readonly t0: number;
  readonly t1: number;
  readonly distanceMm: number;
};

// Keyed on the stored subpath (or legacy polyline), which is immutable, so a
// sampling is reused until that subpath is edited.
const samplingCache = new WeakMap<object, SampledSubpath>();
const REFINE_STEPS = 48;
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;

export function hitPathSegment(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
  point: Vec2,
  pxToMm: number,
): PathSegmentHit | null {
  if (!('paths' in object)) return null;
  const radiusMm = Math.max(0, PATH_SEGMENT_HIT_RADIUS_PX * pxToMm);
  const lookup = sceneLayerVisibility.lookup(layers);
  let best: PathSegmentHit | null = null;
  for (const [pathIndex, path] of object.paths.entries()) {
    if (!sceneLayerVisibility.resolvePath(object, path, lookup).visible) continue;
    for (const [polylineIndex, sampled] of sampledSubpaths(path).entries()) {
      const coarse = nearestChord(object.transform, sampled, point);
      const slack = sampled.tolerance * transformScale(object.transform);
      if (coarse === null || coarse.distanceMm > radiusMm + slack) continue;
      const hit = refine(object.transform, sampled.subpath, coarse, point);
      if (hit === null || hit.distanceMm > radiusMm) continue;
      if (best !== null && hit.distanceMm >= best.distanceMm) continue;
      best = {
        t: hit.t,
        point: hit.point,
        distanceMm: hit.distanceMm,
        ref: { objectId: object.id, pathIndex, polylineIndex, segmentIndex: coarse.segmentIndex },
      };
    }
  }
  return best;
}

/** Each subpath of the path in explicit form, with its sampling. */
export function sampledSubpaths(path: ColoredPath): ReadonlyArray<SampledSubpath> {
  const curves = canonicalCurves(path);
  return curves.map((curve, index) => {
    const key: object = path.curves?.[index] ?? path.polylines[index] ?? curve;
    const cached = samplingCache.get(key);
    if (cached !== undefined) return cached;
    const sampled = sampleSubpath(curve);
    samplingCache.set(key, sampled);
    return sampled;
  });
}

function sampleSubpath(curve: CurveSubpath): SampledSubpath {
  const subpath = explicitCurveSubpath(curve);
  const tolerance = Math.max(subpathExtent(subpath) * 1e-3, 1e-4);
  const segments = subpath.segments.map((segment, index) =>
    sampleSegment(segmentStartPoint(subpath, index) as Vec2, segment, tolerance),
  );
  return { subpath, segments, tolerance };
}

function transformScale(transform: Transform): number {
  const scale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  return Number.isFinite(scale) ? scale : 1;
}

function nearestChord(
  transform: Transform,
  sampled: SampledSubpath,
  point: Vec2,
): CoarseHit | null {
  let best: CoarseHit | null = null;
  for (const [segmentIndex, samples] of sampled.segments.entries()) {
    let previous = samples[0];
    let previousScene = previous === undefined ? null : applyTransform(previous.point, transform);
    for (let index = 1; index < samples.length; index += 1) {
      const sample = samples[index] as SegmentSample;
      const scene = applyTransform(sample.point, transform);
      if (previous !== undefined && previousScene !== null) {
        const distanceMm = distanceToChord(point, previousScene, scene);
        if (best === null || distanceMm < best.distanceMm) {
          best = { segmentIndex, t0: previous.t, t1: sample.t, distanceMm };
        }
      }
      previous = sample;
      previousScene = scene;
    }
  }
  return best;
}

type RefinedHit = { readonly t: number; readonly point: Vec2; readonly distanceMm: number };

// A line's nearest point is its projection (placement is affine, so it stays a
// line on the bed); on a curve, golden-section search on the exact segment
// between the two samples that bracket the nearest chord.
function refine(
  transform: Transform,
  subpath: CurveSubpath,
  coarse: CoarseHit,
  point: Vec2,
): RefinedHit | null {
  const segment = subpath.segments[coarse.segmentIndex];
  const from = segmentStartPoint(subpath, coarse.segmentIndex);
  if (segment === undefined || from === null) return null;
  const at = (t: number): Vec2 => applyTransform(pointOnSegment(from, segment, t), transform);
  if (segment.kind === 'line') {
    const t = projectionParameter(point, at(0), at(1));
    const nearest = at(t);
    return { t, point: nearest, distanceMm: Math.sqrt(squaredDistance(nearest, point)) };
  }
  const cost = (t: number): number => squaredDistance(at(t), point);
  let low = coarse.t0;
  let high = coarse.t1;
  let left = high - GOLDEN_RATIO * (high - low);
  let right = low + GOLDEN_RATIO * (high - low);
  let leftCost = cost(left);
  let rightCost = cost(right);
  for (let step = 0; step < REFINE_STEPS; step += 1) {
    if (leftCost <= rightCost) {
      high = right;
      right = left;
      rightCost = leftCost;
      left = high - GOLDEN_RATIO * (high - low);
      leftCost = cost(left);
    } else {
      low = left;
      left = right;
      leftCost = rightCost;
      right = low + GOLDEN_RATIO * (high - low);
      rightCost = cost(right);
    }
  }
  const t = (low + high) / 2;
  const nearest = at(t);
  return { t, point: nearest, distanceMm: Math.sqrt(squaredDistance(nearest, point)) };
}

function subpathExtent(subpath: CurveSubpath): number {
  let minX = subpath.start.x;
  let minY = subpath.start.y;
  let maxX = minX;
  let maxY = minY;
  for (const segment of subpath.segments) {
    minX = Math.min(minX, segment.to.x);
    minY = Math.min(minY, segment.to.y);
    maxX = Math.max(maxX, segment.to.x);
    maxY = Math.max(maxY, segment.to.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

function distanceToChord(point: Vec2, a: Vec2, b: Vec2): number {
  const t = projectionParameter(point, a, b);
  return Math.sqrt(squaredDistance(point, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
}

function projectionParameter(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return 0;
  return Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
}

function squaredDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
