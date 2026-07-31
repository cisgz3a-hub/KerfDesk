import type { estimateBoxWork } from '../../core/box';

type BoxWorkEstimate = ReturnType<typeof estimateBoxWork>;

export const BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD = 20_000;

export function boxEstimateIsLarge(estimate: BoxWorkEstimate): boolean {
  return (
    estimate.saturatedFields.length > 0 ||
    estimate.nominalPointUpper > BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD ||
    estimate.reliefBooleanInputVertexUpper > BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD
  );
}
