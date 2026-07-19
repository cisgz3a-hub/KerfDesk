import type { Toolpath, ToolpathStep } from '../../core/job';
import type { JobDurationBreakdown } from '../../core/job/estimate-duration';

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
  breakdown: JobDurationBreakdown,
): PreviewTimeline {
  const cutSeconds = finiteNonNegative(breakdown.cutSeconds);
  const travelSeconds = finiteNonNegative(breakdown.travelSeconds);
  const timing = previewCategoryTiming(toolpath, breakdown, cutSeconds, travelSeconds);
  const segments: PreviewTimelineSegment[] = [];
  let distanceMm = 0;
  let seconds = 0;

  for (const step of toolpath.steps) {
    const length = finiteNonNegative(step.length);
    if (length === 0) continue;
    const category = timelineCategory(step, timing.detailedTravel);
    const categoryTiming = timing[category];
    const duration =
      categoryTiming.distanceMm > 0
        ? (categoryTiming.seconds * length) / categoryTiming.distanceMm
        : 0;
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

type TimelineCategory = 'cut' | 'travel' | 'rapid-travel' | 'feed-travel';

type CategoryTiming = { readonly distanceMm: number; readonly seconds: number };

type PreviewCategoryTiming = Readonly<Record<TimelineCategory, CategoryTiming>> & {
  readonly detailedTravel: boolean;
};

function previewCategoryTiming(
  toolpath: Toolpath,
  breakdown: JobDurationBreakdown,
  cutSeconds: number,
  travelSeconds: number,
): PreviewCategoryTiming {
  const cutDistanceMm = sumStepLengths(toolpath.steps, (step) => step.kind !== 'travel');
  const travelDistanceMm = sumStepLengths(toolpath.steps, (step) => step.kind === 'travel');
  const rapidTravelDistanceMm = sumStepLengths(
    toolpath.steps,
    (step) => step.kind === 'travel' && step.motion !== 'feed',
  );
  const feedTravelDistanceMm = sumStepLengths(
    toolpath.steps,
    (step) => step.kind === 'travel' && step.motion === 'feed',
  );
  const detailed = detailedTravelTiming(
    breakdown,
    travelSeconds,
    rapidTravelDistanceMm,
    feedTravelDistanceMm,
  );
  return {
    cut: { distanceMm: cutDistanceMm, seconds: cutSeconds },
    travel: { distanceMm: travelDistanceMm, seconds: travelSeconds },
    'rapid-travel': {
      distanceMm: rapidTravelDistanceMm,
      seconds: detailed?.rapidTravelSeconds ?? 0,
    },
    'feed-travel': {
      distanceMm: feedTravelDistanceMm,
      seconds: detailed?.feedTravelSeconds ?? 0,
    },
    detailedTravel: detailed !== null,
  };
}

function timelineCategory(step: ToolpathStep, detailed: boolean): TimelineCategory {
  if (step.kind !== 'travel') return 'cut';
  if (!detailed) return 'travel';
  return step.motion === 'feed' ? 'feed-travel' : 'rapid-travel';
}

function detailedTravelTiming(
  breakdown: JobDurationBreakdown,
  travelSeconds: number,
  rapidTravelDistanceMm: number,
  feedTravelDistanceMm: number,
): { readonly rapidTravelSeconds: number; readonly feedTravelSeconds: number } | null {
  const rawRapid = breakdown.rapidTravelSeconds;
  const rawFeed = breakdown.feedTravelSeconds;
  if (!isFiniteNonNegative(rawRapid) || !isFiniteNonNegative(rawFeed)) return null;
  const detailTotal = rawRapid + rawFeed;
  const tolerance = 1e-6 * Math.max(1, travelSeconds);
  if (Math.abs(detailTotal - travelSeconds) > tolerance) return null;
  // Some legacy/raster toolpaths do not yet tag every feed leg. Fall back to
  // the original aggregate travel pacing instead of dropping category time.
  if (rawRapid > 0 && rapidTravelDistanceMm <= 0) return null;
  if (rawFeed > 0 && feedTravelDistanceMm <= 0) return null;
  return { rapidTravelSeconds: rawRapid, feedTravelSeconds: rawFeed };
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

function isFiniteNonNegative(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
