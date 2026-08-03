import type { Vec2 } from '../scene';

const SAMPLE_BUDGET_PER_REGION = 4_096;
const MAX_SAMPLE_SEGMENT_PRODUCT = 8_000_000;

export function vcarveMedialSampleBudget(segmentCount: number): number {
  if (segmentCount <= 0) return SAMPLE_BUDGET_PER_REGION;
  return Math.max(
    3,
    Math.min(SAMPLE_BUDGET_PER_REGION, Math.floor(MAX_SAMPLE_SEGMENT_PRODUCT / segmentCount)),
  );
}

export function vcarvePointBounds(points: ReadonlyArray<Vec2>): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
