// Everything Preview reads from the whole route, computed in one place
// (ADR-598 Amendment 2, performance audit S1-P2-1).
//
// The stats panel, the pass stepper, the display-decimation notice and the
// playback timeline each walked every step of the route on the UI thread.
// At 375k lines that held the thread for 0.6–1.6 s whenever Preview opened
// during a job, and an Abort pressed then waited behind it. The preparation
// worker now builds this summary beside the route it already builds, and it
// crosses with the route's header. A route built on this thread (small enough
// for the synchronous budget) is summarized here once and cached.
//
// The timeline basis is three running sums of distance — cut, rapid travel
// and laser-off feed travel — one entry per step of nonzero length. Time is
// linear in each, so the timeline for any estimate is those sums scaled by
// three rates, with nothing to rebuild per step (preview-timeline.ts).

import {
  summarizeToolpathDistances,
  type Toolpath,
  type ToolpathDistanceSummary,
} from '../../core/job';
import { visitToolpathStepFacts } from '../../core/job/toolpath-step-facts';
import { previewRouteForDrawing } from './executable-plan-preview-route';
import {
  previewDisplayDecimation,
  type PreviewDisplayDecimation,
} from './preview-display-decimation';
import type { PreviewToolpath } from './preview-status';

export type PreviewRouteTimelineBasis = {
  /** Non-travel distance (cuts and plunges), the timeline's cut bucket. */
  readonly cutMm: number;
  readonly travelMm: number;
  /** Travel not tagged as feed: tagged rapids and untagged legacy travel. */
  readonly rapidTravelMm: number;
  readonly feedTravelMm: number;
  /** Running sums at the end of each step of nonzero length, in route order. */
  readonly endCutMm: Float64Array;
  readonly endRapidTravelMm: Float64Array;
  readonly endFeedTravelMm: Float64Array;
};

export type PreviewRouteSummary = {
  /** The route this describes; a summary that does not match is ignored. */
  readonly stepCount: number;
  readonly totalLength: number;
  readonly distances: ToolpathDistanceSummary;
  /** Arc-length fractions of each downward plunge: CNC pass starts. */
  readonly passBoundaries: ReadonlyArray<number>;
  /** Of the route Preview draws, which may be the verified plan route. */
  readonly displayDecimation: PreviewDisplayDecimation | null;
  readonly timeline: PreviewRouteTimelineBasis;
};

export type PreviewRouteSummaryCarrier = {
  /** Built by the preparation worker and carried in the route's header. */
  readonly routeSummary?: PreviewRouteSummary;
};

const summarizedHere = new WeakMap<Toolpath, PreviewRouteSummary>();

/** The route's carried summary, or one built on this thread and cached. */
export function previewRouteSummary(toolpath: Toolpath): PreviewRouteSummary {
  const carried = (toolpath as PreviewToolpath).routeSummary;
  if (carried !== undefined && summaryDescribes(carried, toolpath)) return carried;
  const cached = summarizedHere.get(toolpath);
  if (cached !== undefined) return cached;
  const summary = summarizePreviewRoute(toolpath);
  summarizedHere.set(toolpath, summary);
  return summary;
}

/** Attach a summary, for the worker to send with the route. */
export function withPreviewRouteSummary<T extends PreviewToolpath>(toolpath: T): T {
  return { ...toolpath, routeSummary: summarizePreviewRoute(toolpath) };
}

/** The summary's buffers, to transfer rather than clone beside a packed route. */
export function previewRouteSummaryTransferables(
  summary: PreviewRouteSummary | undefined,
): ReadonlyArray<ArrayBuffer> {
  if (summary === undefined) return [];
  const { endCutMm, endRapidTravelMm, endFeedTravelMm } = summary.timeline;
  return [endCutMm.buffer, endRapidTravelMm.buffer, endFeedTravelMm.buffer].filter(
    (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
  );
}

export function summarizePreviewRoute(toolpath: Toolpath): PreviewRouteSummary {
  return {
    stepCount: toolpath.steps.length,
    totalLength: toolpath.totalLength,
    distances: summarizeToolpathDistances(toolpath),
    ...walkTimelineAndPasses(toolpath),
    displayDecimation: previewDisplayDecimation(previewRouteForDrawing(toolpath)),
  };
}

function summaryDescribes(summary: PreviewRouteSummary, toolpath: Toolpath): boolean {
  return (
    summary.stepCount === toolpath.steps.length &&
    Object.is(summary.totalLength, toolpath.totalLength)
  );
}

function walkTimelineAndPasses(
  toolpath: Toolpath,
): Pick<PreviewRouteSummary, 'passBoundaries' | 'timeline'> {
  const capacity = toolpath.steps.length;
  const endCut = new Float64Array(capacity);
  const endRapid = new Float64Array(capacity);
  const endFeed = new Float64Array(capacity);
  const passBoundaries: number[] = [];
  const countsPasses = !(toolpath.totalLength <= 0);
  let cutMm = 0;
  let travelMm = 0;
  let rapidTravelMm = 0;
  let feedTravelMm = 0;
  let walked = 0;
  let entries = 0;
  visitToolpathStepFacts(toolpath.steps, (step) => {
    // Pass starts use the raw length, as the stepper always has.
    if (countsPasses && step.kind === 'plunge' && step.descends) {
      passBoundaries.push(walked / toolpath.totalLength);
    }
    walked += step.length;
    const length = finiteNonNegative(step.length);
    if (length === 0) return;
    if (step.kind !== 'travel') cutMm += length;
    else {
      travelMm += length;
      if (step.motion === 'feed') feedTravelMm += length;
      else rapidTravelMm += length;
    }
    endCut[entries] = cutMm;
    endRapid[entries] = rapidTravelMm;
    endFeed[entries] = feedTravelMm;
    entries += 1;
  });
  return {
    passBoundaries,
    timeline: {
      cutMm,
      travelMm,
      rapidTravelMm,
      feedTravelMm,
      // Each sum gets its own buffer, sized to its entries, so all three can
      // be transferred.
      endCutMm: entries === capacity ? endCut : endCut.slice(0, entries),
      endRapidTravelMm: entries === capacity ? endRapid : endRapid.slice(0, entries),
      endFeedTravelMm: entries === capacity ? endFeed : endFeed.slice(0, entries),
    },
  };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
