import type { Toolpath } from '../../core/job';
import type { JobDurationBreakdown } from '../../core/job/estimate-duration';
import { previewRouteSummary, type PreviewRouteTimelineBasis } from './preview-route-summary';
import { isNonNegativeFiniteNumber } from '../../core/util/finite';

export type PreviewTimeline = SegmentPreviewTimeline | RoutePreviewTimeline;

/** Explicit spans: an imported program's per-line timing, dwells included. */
export type SegmentPreviewTimeline = {
  readonly totalDistanceMm: number;
  readonly totalSeconds: number;
  readonly segments: ReadonlyArray<PreviewTimelineSegment>;
};

export type PreviewTimelineSegment = {
  readonly startDistanceMm: number;
  readonly endDistanceMm: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
};

/**
 * A project route's timeline: one span per step of nonzero length, each paced
 * by its category. Rather than one record per step, it keeps the route
 * summary's running distance sums and a rate for each, so building it costs
 * nothing per step and a lookup is a binary search (S1-P2-1).
 */
type RoutePreviewTimeline = {
  readonly totalDistanceMm: number;
  readonly totalSeconds: number;
  readonly route: {
    readonly basis: PreviewRouteTimelineBasis;
    readonly cutSecondsPerMm: number;
    readonly rapidSecondsPerMm: number;
    readonly feedSecondsPerMm: number;
  };
};

export function buildPreviewTimeline(
  toolpath: Toolpath,
  breakdown: JobDurationBreakdown,
): PreviewTimeline {
  const basis = previewRouteSummary(toolpath).timeline;
  const cutSeconds = finiteNonNegative(breakdown.cutSeconds);
  const travelSeconds = finiteNonNegative(breakdown.travelSeconds);
  const motionSeconds = cutSeconds + travelSeconds;
  const totalSeconds =
    motionSeconds +
    finiteNonNegative(breakdown.dwellSeconds ?? 0) +
    finiteNonNegative(breakdown.transportSeconds ?? 0);
  // The geometric Preview distributes category time over distance. Include
  // non-motion time proportionately; exact event timing belongs to the emitted
  // program/live clock, since this preview route has no source-line mapping.
  const overheadScale = motionSeconds > 0 ? totalSeconds / motionSeconds : 1;
  const detailed = detailedTravelTiming(
    breakdown,
    travelSeconds,
    basis.rapidTravelMm,
    basis.feedTravelMm,
  );
  const rate = (seconds: number, distanceMm: number): number =>
    distanceMm > 0 ? (seconds * overheadScale) / distanceMm : 0;
  const travelRate = rate(travelSeconds, basis.travelMm);
  const route = {
    basis,
    cutSecondsPerMm: rate(cutSeconds, basis.cutMm),
    rapidSecondsPerMm:
      detailed === null ? travelRate : rate(detailed.rapidTravelSeconds, basis.rapidTravelMm),
    feedSecondsPerMm:
      detailed === null ? travelRate : rate(detailed.feedTravelSeconds, basis.feedTravelMm),
  };
  const spans = routeSpans(route);
  return {
    totalDistanceMm: spans.count === 0 ? 0 : spans.endDistance(spans.count - 1),
    totalSeconds,
    route,
  };
}

function detailedTravelTiming(
  breakdown: JobDurationBreakdown,
  travelSeconds: number,
  rapidTravelDistanceMm: number,
  feedTravelDistanceMm: number,
): { readonly rapidTravelSeconds: number; readonly feedTravelSeconds: number } | null {
  const rawRapid = breakdown.rapidTravelSeconds;
  const rawFeed = breakdown.feedTravelSeconds;
  if (!isNonNegativeFiniteNumber(rawRapid) || !isNonNegativeFiniteNumber(rawFeed)) return null;
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
  const spans = timelineSpans(timeline);
  const index = firstSpanEndingAtOrAfter(spans.count, spans.endDistance, distance);
  if (index === null) return timeline.totalSeconds;
  return interpolate(
    spans.startDistance(index),
    spans.endDistance(index),
    spans.startSeconds(index),
    spans.endSeconds(index),
    distance,
  );
}

export function scrubberAtElapsedSeconds(
  timeline: PreviewTimeline,
  elapsedSeconds: number,
): number {
  const elapsed = Math.max(0, Math.min(finiteNonNegative(elapsedSeconds), timeline.totalSeconds));
  if (timeline.totalDistanceMm <= 0 || timeline.totalSeconds <= 0) return 0;
  const spans = timelineSpans(timeline);
  const index = firstSpanEndingAtOrAfter(spans.count, spans.endSeconds, elapsed);
  if (index === null) return 1;
  const distance = interpolate(
    spans.startSeconds(index),
    spans.endSeconds(index),
    spans.startDistance(index),
    spans.endDistance(index),
    elapsed,
  );
  return clamp01(distance / timeline.totalDistanceMm);
}

type TimelineSpans = {
  readonly count: number;
  readonly startDistance: (index: number) => number;
  readonly endDistance: (index: number) => number;
  readonly startSeconds: (index: number) => number;
  readonly endSeconds: (index: number) => number;
};

function timelineSpans(timeline: PreviewTimeline): TimelineSpans {
  if ('route' in timeline) return routeSpans(timeline.route);
  const { segments } = timeline;
  const at = (index: number): PreviewTimelineSegment => {
    const segment = segments[index];
    if (segment === undefined) throw new Error(`Preview timeline span ${index} is missing.`);
    return segment;
  };
  return {
    count: segments.length,
    startDistance: (index) => at(index).startDistanceMm,
    endDistance: (index) => at(index).endDistanceMm,
    startSeconds: (index) => at(index).startSeconds,
    endSeconds: (index) => at(index).endSeconds,
  };
}

function routeSpans(route: RoutePreviewTimeline['route']): TimelineSpans {
  const { endCutMm, endRapidTravelMm, endFeedTravelMm } = route.basis;
  const cut = (index: number): number => endCutMm[index] ?? 0;
  const rapid = (index: number): number => endRapidTravelMm[index] ?? 0;
  const feed = (index: number): number => endFeedTravelMm[index] ?? 0;
  // Each sum only grows and floating-point addition and scaling are
  // monotonic, so both ends stay sorted for the binary search.
  const endDistance = (index: number): number => cut(index) + rapid(index) + feed(index);
  const endSeconds = (index: number): number =>
    route.cutSecondsPerMm * cut(index) +
    route.rapidSecondsPerMm * rapid(index) +
    route.feedSecondsPerMm * feed(index);
  return {
    count: endCutMm.length,
    startDistance: (index) => (index === 0 ? 0 : endDistance(index - 1)),
    endDistance,
    startSeconds: (index) => (index === 0 ? 0 : endSeconds(index - 1)),
    endSeconds,
  };
}

/** The first span whose end is at or past `value`; ends never decrease. */
function firstSpanEndingAtOrAfter(
  count: number,
  endOf: (index: number) => number,
  value: number,
): number | null {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (endOf(middle) >= value) high = middle;
    else low = middle + 1;
  }
  return low < count ? low : null;
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
