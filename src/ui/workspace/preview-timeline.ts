import type { Toolpath, ToolpathStep } from '../../core/job';

export type PreviewTimeline = {
  readonly totalDistanceMm: number;
  readonly totalSeconds: number;
  readonly segments: ReadonlyArray<PreviewTimelineSegment>;
};

type PreviewTimelineSegment = {
  readonly startDistanceMm: number;
  readonly endDistanceMm: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
};

export function buildPreviewTimeline(
  toolpath: Toolpath,
  breakdown: { readonly cutSeconds: number; readonly travelSeconds: number },
): PreviewTimeline {
  const cutDistanceMm = sumStepLengths(toolpath.steps, (step) => step.kind !== 'travel');
  const travelDistanceMm = sumStepLengths(toolpath.steps, (step) => step.kind === 'travel');
  const cutSeconds = finiteNonNegative(breakdown.cutSeconds);
  const travelSeconds = finiteNonNegative(breakdown.travelSeconds);
  const segments: PreviewTimelineSegment[] = [];
  let distanceMm = 0;
  let seconds = 0;

  for (const step of toolpath.steps) {
    const length = finiteNonNegative(step.length);
    if (length === 0) continue;
    const categoryDistance = step.kind === 'travel' ? travelDistanceMm : cutDistanceMm;
    const categorySeconds = step.kind === 'travel' ? travelSeconds : cutSeconds;
    const duration = categoryDistance > 0 ? (categorySeconds * length) / categoryDistance : 0;
    segments.push({
      startDistanceMm: distanceMm,
      endDistanceMm: distanceMm + length,
      startSeconds: seconds,
      endSeconds: seconds + duration,
    });
    distanceMm += length;
    seconds += duration;
  }

  return {
    totalDistanceMm: distanceMm,
    totalSeconds: cutSeconds + travelSeconds,
    segments,
  };
}

export function elapsedSecondsAtScrubber(timeline: PreviewTimeline, scrubberT: number): number {
  const distance = clamp01(scrubberT) * timeline.totalDistanceMm;
  if (distance <= 0) return 0;
  for (const segment of timeline.segments) {
    if (distance <= segment.endDistanceMm) {
      return interpolate(
        segment.startDistanceMm,
        segment.endDistanceMm,
        segment.startSeconds,
        segment.endSeconds,
        distance,
      );
    }
  }
  return timeline.totalSeconds;
}

export function scrubberAtElapsedSeconds(
  timeline: PreviewTimeline,
  elapsedSeconds: number,
): number {
  const elapsed = Math.max(0, Math.min(finiteNonNegative(elapsedSeconds), timeline.totalSeconds));
  if (timeline.totalDistanceMm <= 0 || timeline.totalSeconds <= 0) return 0;
  for (const segment of timeline.segments) {
    if (elapsed <= segment.endSeconds) {
      const distance = interpolate(
        segment.startSeconds,
        segment.endSeconds,
        segment.startDistanceMm,
        segment.endDistanceMm,
        elapsed,
      );
      return clamp01(distance / timeline.totalDistanceMm);
    }
  }
  return 1;
}

function sumStepLengths(
  steps: ReadonlyArray<ToolpathStep>,
  include: (step: ToolpathStep) => boolean,
): number {
  return steps.reduce(
    (total, step) => total + (include(step) ? finiteNonNegative(step.length) : 0),
    0,
  );
}

function interpolate(
  fromInput: number,
  toInput: number,
  fromOutput: number,
  toOutput: number,
  input: number,
): number {
  const span = toInput - fromInput;
  if (span <= 0) return toOutput;
  const t = Math.max(0, Math.min(1, (input - fromInput) / span));
  return fromOutput + (toOutput - fromOutput) * t;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
