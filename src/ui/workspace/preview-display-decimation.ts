import type { Toolpath } from '../../core/job';
import { visitToolpathStepFacts, type ToolpathStepFacts } from '../../core/job/toolpath-step-facts';
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
  // The drawn steps are displayStepIndices' picks: every stride-th index and
  // the last. Testing each index against the stride in the same walk keeps
  // this one pass over the step facts, with no step object built (S1-P2-1).
  const stepCount = toolpath.steps.length;
  const stride = strideForSegmentBudget(stepCount, threshold);
  let sourceSegments = 0;
  let drawnSteps = 0;
  let drawnSegments = 0;
  visitToolpathStepFacts(toolpath.steps, (step, index) => {
    sourceSegments += step.segmentCount;
    if (index % stride !== 0 && index !== stepCount - 1) return;
    drawnSteps += 1;
    drawnSegments += displaySegmentCount(step, threshold);
  });
  if (drawnSteps === stepCount && drawnSegments === sourceSegments) return null;
  return {
    threshold,
    sourceSteps: stepCount,
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

function displaySegmentCount(step: ToolpathStepFacts, threshold: number): number {
  const source = step.segmentCount;
  if (step.kind !== 'cut') return source;
  const stride = strideForSegmentBudget(source, threshold);
  return stride <= 1 ? source : Math.ceil(source / stride);
}
