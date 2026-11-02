// The route summary must show exactly what Preview showed before it existed
// (ADR-598 Amendment 2). The reference implementations below are the walks it
// replaced, copied unchanged, and they run over the same routes as plain
// arrays and as packed columns.

import { describe, expect, it } from 'vitest';
import type { Toolpath, ToolpathDistanceSummary, ToolpathStep } from '../../core/job';
import type { JobDurationBreakdown } from '../../core/job/estimate-duration';
import { packedToolpathSteps } from '../../core/job/packed-toolpath-steps';
import { strideForSegmentBudget } from './draw-complexity';
import { previewDisplayDecimation } from './preview-display-decimation';
import { previewRouteSummary, summarizePreviewRoute } from './preview-route-summary';
import {
  buildPreviewTimeline,
  elapsedSecondsAtScrubber,
  scrubberAtElapsedSeconds,
} from './preview-timeline';

function randomRoute(seed: number, count: number): Toolpath {
  let state = seed;
  const random = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const steps: ToolpathStep[] = [];
  let x = 0;
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    // About one step in twenty has no length, which the timeline skips.
    const length = random() < 0.05 ? 0 : Math.round(random() * 4000) / 100;
    if (roll < 0.15) {
      const fromZ = random() * 3;
      steps.push({ kind: 'plunge', at: { x, y: 0 }, fromZ, toZ: random() * 3, length });
    } else if (roll < 0.55) {
      const motion = random();
      steps.push({
        kind: 'travel',
        from: { x, y: 0 },
        to: { x: x + length, y: 0 },
        length,
        ...(motion < 0.3 ? {} : { motion: motion < 0.65 ? ('rapid' as const) : ('feed' as const) }),
      });
    } else {
      const points = 2 + Math.floor(random() * 6);
      steps.push({
        kind: 'cut',
        color: '#112233',
        polyline: Array.from({ length: points }, (_, point) => ({ x: x + point, y: point % 2 })),
        length,
      });
    }
    x += length;
  }
  return { steps, totalLength: steps.reduce((sum, step) => sum + step.length, 0) };
}

function packed(route: Toolpath): Toolpath {
  return { steps: packedToolpathSteps(route.steps), totalLength: route.totalLength };
}

const BREAKDOWNS: ReadonlyArray<JobDurationBreakdown> = [
  { cutSeconds: 90, travelSeconds: 10 },
  { cutSeconds: 60, travelSeconds: 30, rapidTravelSeconds: 20, feedTravelSeconds: 10 },
  { cutSeconds: 40, travelSeconds: 25, dwellSeconds: 7, transportSeconds: 13 },
  // Detail that does not add up falls back to aggregate travel pacing.
  { cutSeconds: 40, travelSeconds: 25, rapidTravelSeconds: 5, feedTravelSeconds: 5 },
];

describe('preview route summary matches the walks it replaced', () => {
  for (const [label, toRoute] of [
    ['plain', (route: Toolpath) => route],
    ['packed', packed],
  ] as const) {
    it(`gives the same distances, pass starts and decimation for a ${label} route`, () => {
      for (const seed of [1, 7, 42]) {
        const source = randomRoute(seed, 900);
        const route = toRoute(source);
        const summary = summarizePreviewRoute(route);
        expect(summary.distances).toEqual(legacyDistances(source));
        expect(summary.passBoundaries).toEqual(legacyPassBoundaries(source));
        expect(summary.passBoundaries.length).toBeGreaterThan(0);
        for (const threshold of [100, 2_000, 1_000_000]) {
          expect(previewDisplayDecimation(route, threshold)).toEqual(
            legacyDisplayDecimation(source, threshold),
          );
        }
      }
    });

    it(`gives the same playback timing for a ${label} route`, () => {
      for (const seed of [3, 11]) {
        const source = randomRoute(seed, 700);
        const route = toRoute(source);
        for (const breakdown of BREAKDOWNS) {
          const legacy = legacyTimeline(source, breakdown);
          const timeline = buildPreviewTimeline(route, breakdown);
          expect(timeline.totalSeconds).toBe(legacy.totalSeconds);
          expect(timeline.totalDistanceMm).toBeCloseTo(legacy.totalDistanceMm, 6);
          for (let sample = 0; sample <= 200; sample += 1) {
            const t = sample / 200;
            expect(elapsedSecondsAtScrubber(timeline, t)).toBeCloseTo(
              legacyElapsedAt(legacy, t),
              6,
            );
            const elapsed = t * legacy.totalSeconds;
            expect(scrubberAtElapsedSeconds(timeline, elapsed)).toBeCloseTo(
              legacyScrubberAt(legacy, elapsed),
              9,
            );
          }
        }
      }
    });
  }

  it('summarizes a route built on this thread once, and trusts only a matching carried summary', () => {
    const source = randomRoute(5, 50);
    const first = previewRouteSummary(source);
    expect(previewRouteSummary(source)).toBe(first);
    const carried = { ...source, routeSummary: first };
    expect(previewRouteSummary(carried)).toBe(first);
    // A summary of some other route is ignored rather than shown.
    const other = { ...randomRoute(6, 51), routeSummary: first };
    expect(previewRouteSummary(other)).not.toBe(first);
    expect(previewRouteSummary(other).stepCount).toBe(51);
  });
});

// ---- The walks the summary replaced, unchanged ---------------------------

function legacyDistances(toolpath: Toolpath): ToolpathDistanceSummary {
  let cutMm = 0;
  let travelMm = 0;
  let plungeMm = 0;
  for (const step of toolpath.steps) {
    if (step.kind === 'cut') cutMm += step.length;
    else if (step.kind === 'plunge') plungeMm += step.length;
    else travelMm += step.length;
  }
  return { cutMm, travelMm, plungeMm, totalMm: cutMm + travelMm + plungeMm };
}

function legacyPassBoundaries(toolpath: Toolpath): ReadonlyArray<number> {
  if (toolpath.totalLength <= 0) return [];
  const fractions: number[] = [];
  let walked = 0;
  for (const step of toolpath.steps) {
    if (step.kind === 'plunge' && step.toZ < step.fromZ) {
      fractions.push(walked / toolpath.totalLength);
    }
    walked += step.length;
  }
  return fractions;
}

function legacyDisplayDecimation(toolpath: Toolpath, threshold: number) {
  const sourceSegmentCount = (step: ToolpathStep): number =>
    step.kind === 'travel' ? 1 : step.kind === 'plunge' ? 0 : Math.max(0, step.polyline.length - 1);
  let sourceSegments = 0;
  for (const step of toolpath.steps) sourceSegments += sourceSegmentCount(step);
  let drawnSteps = 0;
  let drawnSegments = 0;
  const stride = strideForSegmentBudget(toolpath.steps.length, threshold);
  const indices: number[] = [];
  let last = -1;
  for (let index = 0; index < toolpath.steps.length; index += stride) {
    indices.push(index);
    last = index;
  }
  if (toolpath.steps.length - 1 > last) indices.push(toolpath.steps.length - 1);
  for (const index of indices) {
    const step = toolpath.steps.at(index);
    if (step === undefined) continue;
    drawnSteps += 1;
    const source = sourceSegmentCount(step);
    const pointStride = step.kind === 'cut' ? strideForSegmentBudget(source, threshold) : 1;
    drawnSegments += pointStride <= 1 ? source : Math.ceil(source / pointStride);
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

type LegacySegment = {
  readonly startDistanceMm: number;
  readonly endDistanceMm: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
};
type LegacyTimeline = {
  readonly totalDistanceMm: number;
  readonly totalSeconds: number;
  readonly segments: ReadonlyArray<LegacySegment>;
};

function legacyTimeline(toolpath: Toolpath, breakdown: JobDurationBreakdown): LegacyTimeline {
  const finite = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);
  const sum = (include: (step: ToolpathStep) => boolean): number =>
    toolpath.steps.reduce((total, step) => total + (include(step) ? finite(step.length) : 0), 0);
  const cutSeconds = finite(breakdown.cutSeconds);
  const travelSeconds = finite(breakdown.travelSeconds);
  const motionSeconds = cutSeconds + travelSeconds;
  const totalSeconds =
    motionSeconds + finite(breakdown.dwellSeconds ?? 0) + finite(breakdown.transportSeconds ?? 0);
  const overheadScale = motionSeconds > 0 ? totalSeconds / motionSeconds : 1;
  const cutDistance = sum((step) => step.kind !== 'travel');
  const travelDistance = sum((step) => step.kind === 'travel');
  const rapidDistance = sum((step) => step.kind === 'travel' && step.motion !== 'feed');
  const feedDistance = sum((step) => step.kind === 'travel' && step.motion === 'feed');
  const detailed = legacyDetailedTravel(breakdown, travelSeconds, rapidDistance, feedDistance);
  const timing = (step: ToolpathStep): { distance: number; seconds: number } => {
    if (step.kind !== 'travel') return { distance: cutDistance, seconds: cutSeconds };
    if (detailed === null) return { distance: travelDistance, seconds: travelSeconds };
    return step.motion === 'feed'
      ? { distance: feedDistance, seconds: detailed.feed }
      : { distance: rapidDistance, seconds: detailed.rapid };
  };
  const segments: LegacySegment[] = [];
  let distanceMm = 0;
  let seconds = 0;
  for (const step of toolpath.steps) {
    const length = finite(step.length);
    if (length === 0) continue;
    const category = timing(step);
    const duration =
      category.distance > 0 ? (category.seconds * length * overheadScale) / category.distance : 0;
    segments.push({
      startDistanceMm: distanceMm,
      endDistanceMm: distanceMm + length,
      startSeconds: seconds,
      endSeconds: seconds + duration,
    });
    distanceMm += length;
    seconds += duration;
  }
  return { totalDistanceMm: distanceMm, totalSeconds, segments };
}

function legacyDetailedTravel(
  breakdown: JobDurationBreakdown,
  travelSeconds: number,
  rapidDistance: number,
  feedDistance: number,
): { readonly rapid: number; readonly feed: number } | null {
  const isFiniteNonNegative = (value: number | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const rawRapid = breakdown.rapidTravelSeconds;
  const rawFeed = breakdown.feedTravelSeconds;
  if (!isFiniteNonNegative(rawRapid) || !isFiniteNonNegative(rawFeed)) return null;
  const tolerance = 1e-6 * Math.max(1, travelSeconds);
  if (Math.abs(rawRapid + rawFeed - travelSeconds) > tolerance) return null;
  if (rawRapid > 0 && rapidDistance <= 0) return null;
  if (rawFeed > 0 && feedDistance <= 0) return null;
  return { rapid: rawRapid, feed: rawFeed };
}

function legacyInterpolate(a: number, b: number, c: number, d: number, input: number): number {
  const span = b - a;
  if (span <= 0) return d;
  const t = Math.max(0, Math.min(1, (input - a) / span));
  return c + (d - c) * t;
}

function legacyElapsedAt(timeline: LegacyTimeline, scrubberT: number): number {
  const distance = Math.max(0, Math.min(1, scrubberT)) * timeline.totalDistanceMm;
  if (distance <= 0) return 0;
  for (const segment of timeline.segments) {
    if (distance <= segment.endDistanceMm) {
      return legacyInterpolate(
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

function legacyScrubberAt(timeline: LegacyTimeline, elapsedSeconds: number): number {
  const elapsed = Math.max(0, Math.min(elapsedSeconds, timeline.totalSeconds));
  if (timeline.totalDistanceMm <= 0 || timeline.totalSeconds <= 0) return 0;
  for (const segment of timeline.segments) {
    if (elapsed <= segment.endSeconds) {
      const distance = legacyInterpolate(
        segment.startSeconds,
        segment.endSeconds,
        segment.startDistanceMm,
        segment.endDistanceMm,
        elapsed,
      );
      return Math.max(0, Math.min(1, distance / timeline.totalDistanceMm));
    }
  }
  return 1;
}
