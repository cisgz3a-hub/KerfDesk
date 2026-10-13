import {
  applyTransform,
  curveNodeCount,
  curveNodePoint,
  type CurveSubpath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../../core/scene';

type IndexedNode = Vec2 & { readonly pointIndex: number };
type NodeHit = { readonly pointIndex: number; readonly distanceSq: number };
const cache = new WeakMap<
  CurveSubpath | Polyline,
  WeakMap<Transform, ReadonlyArray<IndexedNode>>
>();

/** Exact anchor positions, indexed only for picking; editable geometry is never sampled. */
export function hitIndexedPathNode(
  geometry: CurveSubpath | Polyline,
  transform: Transform,
  point: Vec2,
  maxDistanceSq: number,
): NodeHit | null {
  const points = indexedPoints(geometry, transform);
  const radius = Math.sqrt(maxDistanceSq);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const node = points[middle] as IndexedNode;
    if (node.x < point.x - radius) low = middle + 1;
    else high = middle;
  }
  let best: NodeHit | null = null;
  for (let index = low; index < points.length; index += 1) {
    const node = points[index] as IndexedNode;
    if (node.x > point.x + radius) break;
    const dx = node.x - point.x;
    const dy = node.y - point.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > maxDistanceSq) continue;
    if (
      best !== null &&
      (distanceSq > best.distanceSq ||
        (distanceSq === best.distanceSq && node.pointIndex >= best.pointIndex))
    )
      continue;
    best = { pointIndex: node.pointIndex, distanceSq };
  }
  return best;
}

function indexedPoints(
  geometry: CurveSubpath | Polyline,
  transform: Transform,
): ReadonlyArray<IndexedNode> {
  const byTransform = cache.get(geometry) ?? new WeakMap<Transform, ReadonlyArray<IndexedNode>>();
  const existing = byTransform.get(transform);
  if (existing !== undefined) return existing;
  const points: IndexedNode[] = [];
  const count = 'segments' in geometry ? curveNodeCount(geometry) : geometry.points.length;
  for (let pointIndex = 0; pointIndex < count; pointIndex += 1) {
    const point =
      'segments' in geometry ? curveNodePoint(geometry, pointIndex) : geometry.points[pointIndex];
    if (point == null) continue;
    points.push({ ...applyTransform(point, transform), pointIndex });
  }
  points.sort((a, b) => a.x - b.x || a.pointIndex - b.pointIndex);
  byTransform.set(transform, points);
  cache.set(geometry, byTransform);
  return points;
}
