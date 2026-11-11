const SAMPLE_BUDGET_PER_REGION = 4_096;
const MAX_SAMPLE_SEGMENT_PRODUCT = 8_000_000;

export function vcarveMedialSampleBudget(segmentCount: number): number {
  if (segmentCount <= 0) return SAMPLE_BUDGET_PER_REGION;
  return Math.max(
    3,
    Math.min(SAMPLE_BUDGET_PER_REGION, Math.floor(MAX_SAMPLE_SEGMENT_PRODUCT / segmentCount)),
  );
}

export { boundsOfPoints as vcarvePointBounds } from '../geometry/box-math';
