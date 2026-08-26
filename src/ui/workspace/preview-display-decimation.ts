import type { Toolpath, ToolpathStep } from '../../core/job';
import { LARGE_SCENE_SEGMENT_THRESHOLD, strideForSegmentBudget } from './draw-complexity';

export type PreviewDisplayDecimation = {
  readonly threshold: number;
  readonly sourceSteps: number;
  readonly drawnSteps: number;
  readonly sourceSegments: number;
  readonly drawnSegments: number;
};

export function previewDisplayDecimation(
  toolpath: Toolpath,
  threshold = LARGE_SCENE_SEGMENT_THRESHOLD,
): PreviewDisplayDecimation | null {
  let sourceSegments = 0;
  for (const step of toolpath.steps) sourceSegments += sourceSegmentCount(step);
  let drawnSteps = 0;
  let drawnSegments = 0;
  for (const index of displayStepIndices(toolpath.steps.length, threshold)) {
    const step = toolpath.steps[index];
    if (step === undefined) continue;
    drawnSteps += 1;
    drawnSegments += displaySegmentCount(step, threshold);
  }
  if (drawnSteps === toolpath.steps.length && drawnSegments === sourceSegments) return null;
  return {
    threshold,
    sourceSteps: toolpath.steps.length,
    drawnSteps,
    sourceSegments,
    drawnSegments,
  };
}

export function* displayStepIndices(
  stepCount: number,
  threshold = LARGE_SCENE_SEGMENT_THRESHOLD,
): Generator<number> {
  const stride = strideForSegmentBudget(stepCount, threshold);
  let last = -1;
  for (let index = 0; index < stepCount; index += stride) {
    yield index;
    last = index;
  }
  const finalIndex = stepCount - 1;
  if (finalIndex > last) yield finalIndex;
}

export function* displayPolylinePointIndices(
  pointCount: number,
  threshold = LARGE_SCENE_SEGMENT_THRESHOLD,
): Generator<number> {
  if (pointCount <= 0) return;
  const segmentCount = Math.max(0, pointCount - 1);
  const stride = strideForSegmentBudget(segmentCount, threshold);
  yield 0;
  let last = 0;
  for (let index = stride; index < pointCount; index += stride) {
    yield index;
    last = index;
  }
  const finalIndex = pointCount - 1;
  if (finalIndex > last) yield finalIndex;
}

function sourceSegmentCount(step: ToolpathStep): number {
  if (step.kind === 'travel') return 1;
  if (step.kind === 'plunge') return 0;
  return Math.max(0, step.polyline.length - 1);
}

function displaySegmentCount(step: ToolpathStep, threshold: number): number {
  const source = sourceSegmentCount(step);
  if (step.kind !== 'cut') return source;
  const stride = strideForSegmentBudget(source, threshold);
  return stride <= 1 ? source : Math.ceil(source / stride);
}
