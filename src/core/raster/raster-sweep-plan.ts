// Shared raster row geometry for the emitter, route preview, and duration
// model. Wide white gaps become separate sweeps. Each side shares the gap
// without overlap, keeping acceleration and braking outside the burn where
// the available runway permits (ADR-445).

import { rasterPixelRuns, rasterSweepRunsForPixelRun, type RasterSweepRun } from '../raster-output';
import type { RasterPowerValues } from './raster-power-values';

export { rasterRunSurvivesDotWidthCorrection, type RasterSweepRun } from '../raster-output';

const RASTER_GAP_RAPID_THRESHOLD_MM = 5;

export type RasterActiveSpan = {
  readonly firstX: number;
  readonly lastX: number;
};

export type RasterRowSweepPlan = {
  readonly span: RasterActiveSpan;
  readonly leadInMm: number;
  readonly leadOutMm: number;
  /** Adjacent runways which consume their gap reuse one exact meeting point. */
  readonly sharedLeadStartXWorldMm?: number;
  readonly sharedLeadEndXWorldMm?: number;
  /** Ordered G1 motion inside the active span, in world millimetres. */
  readonly runs: ReadonlyArray<RasterSweepRun>;
};

type RasterActiveSpanInput = {
  readonly row: RasterPowerValues;
  readonly pixelWidthMm: number;
};

type RasterRowSweepPlanInput = RasterActiveSpanInput & {
  readonly overscanMm: number;
  readonly reverse: boolean;
  readonly dotWidthCorrectionMm?: number;
  /** Raster bounds.minX. Defaults to zero for span-only consumers. */
  readonly minXWorldMm?: number;
};

type BoundedSplitRunwayInput = {
  readonly index: number;
  readonly count: number;
  readonly requestedMm: number;
  readonly gapBeforeMm: number;
  readonly gapAfterMm: number;
};

export function rasterActiveSpans(input: RasterActiveSpanInput): RasterActiveSpan[] {
  const spans: RasterActiveSpan[] = [];
  let firstX = -1;
  let lastInk = -1;
  for (let x = 0; x < input.row.length; x += 1) {
    if ((input.row[x] ?? 0) <= 0) continue;
    if (firstX === -1) {
      firstX = x;
      lastInk = x;
      continue;
    }
    const gapMm = (x - lastInk - 1) * input.pixelWidthMm;
    if (gapMm > RASTER_GAP_RAPID_THRESHOLD_MM) {
      spans.push({ firstX, lastX: lastInk });
      firstX = x;
    }
    lastInk = x;
  }
  if (firstX !== -1) spans.push({ firstX, lastX: lastInk });
  return spans;
}

export function planRasterRowSweeps(input: RasterRowSweepPlanInput): RasterRowSweepPlan[] {
  const spans = rasterActiveSpans(input);
  const ordered = input.reverse ? [...spans].reverse() : spans;
  const requestedMm = Math.max(0, input.overscanMm);
  const dotWidthCorrectionMm = Math.max(0, input.dotWidthCorrectionMm ?? 0);
  const joins = rasterSplitRunwayJoins(ordered, input, requestedMm);
  return ordered.map((span, index) => {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    const gapBeforeMm =
      previous === undefined
        ? requestedMm
        : gapBetweenSpansMm(previous, span, input.pixelWidthMm, input.reverse);
    const gapAfterMm =
      next === undefined
        ? requestedMm
        : gapBetweenSpansMm(span, next, input.pixelWidthMm, input.reverse);
    const sharedLeadStartXWorldMm = joins[index - 1];
    const sharedLeadEndXWorldMm = joins[index];
    return {
      span,
      ...(sharedLeadStartXWorldMm === undefined ? {} : { sharedLeadStartXWorldMm }),
      ...(sharedLeadEndXWorldMm === undefined ? {} : { sharedLeadEndXWorldMm }),
      runs: planRasterSweepRuns(
        input.row,
        span,
        input.pixelWidthMm,
        input.reverse,
        dotWidthCorrectionMm,
        input.minXWorldMm ?? 0,
      ),
      ...boundedSplitRunwayLengths({
        index,
        count: ordered.length,
        requestedMm,
        gapBeforeMm,
        gapAfterMm,
      }),
    };
  });
}

function rasterSplitRunwayJoins(
  ordered: ReadonlyArray<RasterActiveSpan>,
  input: RasterRowSweepPlanInput,
  requestedMm: number,
): ReadonlyArray<number | undefined> {
  return ordered.slice(1).map((next, index) => {
    const previous = ordered[index];
    if (previous === undefined || requestedMm <= 0) return undefined;
    const gapMm = gapBetweenSpansMm(previous, next, input.pixelWidthMm, input.reverse);
    if (gapMm > 2 * requestedMm) return undefined;
    const endPixel = input.reverse ? previous.firstX : previous.lastX + 1;
    const startPixel = input.reverse ? next.lastX + 1 : next.firstX;
    // Compute once for both sweeps. Separate endpoint +/- half-gap arithmetic
    // can straddle a 0.001 mm rounding tie and invent a backwards seek.
    return (input.minXWorldMm ?? 0) + ((endPixel + startPixel) / 2) * input.pixelWidthMm;
  });
}

function planRasterSweepRuns(
  row: RasterPowerValues,
  span: RasterActiveSpan,
  pixelWidthMm: number,
  reverse: boolean,
  dotWidthCorrectionMm: number,
  minXWorldMm: number,
): RasterSweepRun[] {
  const pixelRuns = rasterPixelRuns(row, span);
  const orderedRuns = reverse ? [...pixelRuns].reverse() : pixelRuns;
  return orderedRuns.flatMap((run) =>
    rasterSweepRunsForPixelRun({
      run,
      pixelWidthMm,
      isReverse: reverse,
      dotWidthCorrectionMm,
      minXWorldMm,
    }),
  );
}

export function rasterControllerCoordinateMm(value: number): number {
  return Number(value.toFixed(3));
}

export function boundedSplitRunwayLengths(
  input: BoundedSplitRunwayInput,
): Pick<RasterRowSweepPlan, 'leadInMm' | 'leadOutMm'> {
  const requestedMm = Math.max(0, input.requestedMm);
  // An entry-only split forces a slower seek's deceleration into the preceding
  // powered span. The speed-dependent scan offset then no longer matches that
  // edge. Reserve a dark exit too; two full runways would overlap on short gaps.
  return {
    leadInMm:
      input.index === 0 ? requestedMm : Math.min(requestedMm, Math.max(0, input.gapBeforeMm) / 2),
    leadOutMm:
      input.index === input.count - 1
        ? requestedMm
        : Math.min(requestedMm, Math.max(0, input.gapAfterMm) / 2),
  };
}

function gapBetweenSpansMm(
  previous: RasterActiveSpan,
  current: RasterActiveSpan,
  pixelWidthMm: number,
  reverse: boolean,
): number {
  const gapPixels = reverse
    ? previous.firstX - current.lastX - 1
    : current.firstX - previous.lastX - 1;
  return Math.max(0, gapPixels * pixelWidthMm);
}
