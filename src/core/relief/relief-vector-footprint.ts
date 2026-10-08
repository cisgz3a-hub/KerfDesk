import type { Vec2 } from '../scene/scene-object';
import type { ReliefVectorMask } from '../scene/relief/relief-authoring';
import { reliefBoundaryContains } from './relief-vector-boundary';

type NormalizedFootprint = {
  readonly polygon: ReadonlyArray<Vec2>;
  readonly centre: Vec2;
  readonly sign: number;
  readonly normalize: (point: Vec2) => Vec2;
};

/** A source pixel grants its whole physical footprint to CAM, not just its centre. */
export function reliefVectorFootprintCovered(
  mask: ReliefVectorMask,
  corners: ReadonlyArray<Vec2>,
): boolean {
  if (corners.length !== 4 || !corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    throw new Error('Relief cell footprint cannot be represented with finite coordinates.');
  if (!corners.every((p) => reliefBoundaryContains(mask, p))) return false;
  const { polygon, centre, sign, normalize } = normalizedFootprint(corners);
  if (!reliefBoundaryContains(mask, centre)) return false;
  for (const ring of mask.rings)
    for (let i = 0; i < ring.points.length; i += 1) {
      const a = normalize(pointAt(ring.points, i)),
        b = normalize(pointAt(ring.points, (i + 1) % ring.points.length));
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite))
        throw new Error('Relief boundary and cell footprint exceed the finite coordinate range.');
      if (segmentVisitsInterior(a, b, polygon, sign)) return false;
    }
  return true;
}

function normalizedFootprint(corners: ReadonlyArray<Vec2>): NormalizedFootprint {
  const minX = Math.min(...corners.map((p) => p.x)),
    minY = Math.min(...corners.map((p) => p.y)),
    width = Math.max(...corners.map((p) => p.x)) - minX,
    height = Math.max(...corners.map((p) => p.y)) - minY;
  if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height))
    throw new Error('Relief cell footprint collapses or exceeds the finite coordinate range.');
  const normalize = (p: Vec2): Vec2 => ({ x: (p.x - minX) / width, y: (p.y - minY) / height });
  const polygon = corners.map(normalize);
  const centre = {
    x: minX + width * (polygon.reduce((sum, p) => sum + p.x, 0) / 4),
    y: minY + height * (polygon.reduce((sum, p) => sum + p.y, 0) / 4),
  };
  const sign = Math.sign(cross(pointAt(polygon, 0), pointAt(polygon, 1), pointAt(polygon, 2)));
  return { polygon, centre, sign, normalize };
}

function pointAt(points: ReadonlyArray<Vec2>, index: number): Vec2 {
  const point = points[index];
  if (point === undefined) throw new Error('Relief boundary or footprint is missing a point.');
  return point;
}

function cross(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Clip to a convex cell, then distinguish its interior from coincident edges. */
function segmentVisitsInterior(a: Vec2, b: Vec2, cell: ReadonlyArray<Vec2>, sign: number): boolean {
  let low = 0,
    high = 1;
  for (let i = 0; i < cell.length; i += 1) {
    const start = pointAt(cell, i),
      end = pointAt(cell, (i + 1) % cell.length);
    const atA = sign * cross(start, end, a),
      atB = sign * cross(start, end, b);
    if (!Number.isFinite(atA) || !Number.isFinite(atB))
      throw new Error('Relief boundary intersection exceeds the finite coordinate range.');
    if (atA < 0 && atB < 0) return false;
    if (atA < 0) low = Math.max(low, atA / (atA - atB));
    if (atB < 0) high = Math.min(high, atA / (atA - atB));
    if (low >= high) return false;
  }
  const fraction = (low + high) / 2;
  const p = { x: a.x * (1 - fraction) + b.x * fraction, y: a.y * (1 - fraction) + b.y * fraction };
  return cell.every(
    (start, i) =>
      sign * cross(start, pointAt(cell, (i + 1) % cell.length), p) > 64 * Number.EPSILON,
  );
}
