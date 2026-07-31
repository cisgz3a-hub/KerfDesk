import type { estimateBoxWork } from '../../core/box';
import type { BoxGenerationMetrics } from './box-generation-worker-protocol';

type BoxWorkEstimate = ReturnType<typeof estimateBoxWork>;

export const BOX_CANVAS_PREVIEW_POINT_BUDGET = 20_000;

export function boxPreviewShouldBeSuppressed(metrics: BoxGenerationMetrics): boolean {
  return metrics.pointCount > BOX_CANVAS_PREVIEW_POINT_BUDGET;
}

export function boxEstimateIsLarge(estimate: BoxWorkEstimate): boolean {
  return (
    estimate.saturatedFields.length > 0 ||
    estimate.nominalPointUpper > BOX_CANVAS_PREVIEW_POINT_BUDGET ||
    estimate.reliefBooleanInputVertexUpper > BOX_CANVAS_PREVIEW_POINT_BUDGET
  );
}
