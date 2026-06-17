import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import { isClosedEnough, type Polyline } from '../scene';

const MIN_OFFSET_FILL_SPACING_MM = 0.05;
const MIN_CONTOUR_AREA_MM2 = 1e-6;
const MAX_OFFSET_FILL_PASSES = 2000;

export type OffsetFillInput = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly spacingMm: number;
};

export function offsetFillContours(input: OffsetFillInput): ReadonlyArray<Polyline> {
  const spacing = Math.max(MIN_OFFSET_FILL_SPACING_MM, input.spacingMm);
  const source = input.polylines.filter(isUsableClosedContour);
  if (source.length === 0) return [];

  let current = offsetBy(source, -spacing / 2);
  const out: Polyline[] = [];
  const passLimit = offsetPassLimit(source, spacing);
  for (let pass = 0; current.length > 0 && pass < passLimit; pass += 1) {
    out.push(...current);
    current = offsetBy(current, -spacing);
  }
  return out;
}

function offsetBy(polylines: ReadonlyArray<Polyline>, offsetMm: number): ReadonlyArray<Polyline> {
  try {
    return offsetClosedPolylinesForKerf(polylines, offsetMm).filter(isUsableClosedContour);
  } catch {
    return [];
  }
}

function offsetPassLimit(polylines: ReadonlyArray<Polyline>, spacing: number): number {
  const bounds = polylineBounds(polylines);
  if (bounds === null) return 0;
  const maxSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return Math.min(MAX_OFFSET_FILL_PASSES, Math.max(1, Math.ceil(maxSpan / spacing) + 2));
}

function polylineBounds(polylines: ReadonlyArray<Polyline>): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polyline of polylines) {
    for (const point of polyline.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

function isUsableClosedContour(polyline: Polyline): boolean {
  return isClosedEnough(polyline) && Math.abs(signedArea(polyline)) > MIN_CONTOUR_AREA_MM2;
}

function signedArea(polyline: Polyline): number {
  let area = 0;
  for (let i = 0; i < polyline.points.length; i += 1) {
    const a = polyline.points[i];
    const b = polyline.points[(i + 1) % polyline.points.length];
    if (a === undefined || b === undefined) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
