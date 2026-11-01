/** Inclusive pixel extent for one same-power raster run. */
export type RasterPixelRun = {
  readonly firstX: number;
  readonly lastX: number;
  readonly s: number;
};

/** One ordered G1 power transition inside a planned raster span. */
export type RasterSweepRun = {
  readonly startXWorldMm: number;
  readonly endXWorldMm: number;
  readonly s: number;
};

/** Inclusive row slice to segment by exact raster power. */
export type RasterPixelSpan = {
  readonly firstX: number;
  readonly lastX: number;
};

/** Scan geometry and correction for a row's exact-power runs. */
export type RasterRunGeometry = {
  readonly pixelWidthMm: number;
  readonly isReverse: boolean;
  readonly dotWidthCorrectionMm: number;
  readonly minXWorldMm: number;
};

/** One active span's exact-power runs, in scan order, and their geometry. */
export type RasterSweepRunsForPixelRunsInput = RasterRunGeometry & {
  readonly runs: ReadonlyArray<RasterPixelRun>;
};

type BurnEdges = { readonly burnStartX: number; readonly burnEndX: number };

/** Split an inclusive raster span whenever its exact S value changes. */
export function rasterPixelRuns(row: RasterPowerValues, span: RasterPixelSpan): RasterPixelRun[] {
  const runs: RasterPixelRun[] = [];
  let firstX = span.firstX;
  let s = row[firstX] ?? 0;
  for (let x = span.firstX + 1; x <= span.lastX; x += 1) {
    const nextS = row[x] ?? 0;
    if (nextS === s) continue;
    runs.push({ firstX, lastX: x - 1, s });
    firstX = x;
    s = nextS;
  }
  runs.push({ firstX, lastX: span.lastX, s });
  return runs;
}

/**
 * Expand a span's exact-power runs into dot-width-corrected G1 moves.
 *
 * A burned line is a stretch of consecutive powered runs. Dot Width Correction
 * shortens it only where the beam turns on and where it turns off. A change
 * between two non-zero powers keeps the beam lit, so it is never trimmed and
 * a Grayscale row keeps its tone (ADR-458 Amendment 1).
 */
export function rasterSweepRunsForPixelRuns(
  input: RasterSweepRunsForPixelRunsInput,
): RasterSweepRun[] {
  const sweepRuns: RasterSweepRun[] = [];
  let first = 0;
  while (first < input.runs.length) {
    const end = burnedLineEnd(input.runs, first);
    appendLineSweepRuns(sweepRuns, input.runs, first, end, input);
    first = end;
  }
  return sweepRuns;
}

/**
 * Report every powered exact-power run of `row` that keeps no burn once Dot
 * Width Correction shortens its burned line. Reads each pixel once and calls
 * `onLost` with the run's pixel range [firstX, endX). Returns whether the row
 * holds any power.
 */
export function forEachRasterRunLostToDotWidthCorrection(
  row: RasterPowerValues,
  geometry: RasterRunGeometry,
  onLost: (firstX: number, endX: number) => void,
): boolean {
  const line: RasterPixelRun[] = [];
  let hasPower = false;
  let firstX = 0;
  let s = row[0] ?? 0;
  for (let x = 1; x <= row.length; x += 1) {
    const nextS = x < row.length ? (row[x] ?? 0) : -1;
    if (nextS === s) continue;
    if (s > 0) {
      hasPower = true;
      line.push({ firstX, lastX: x - 1, s });
      if (nextS <= 0) {
        reportLostRuns(line, geometry, onLost);
        line.length = 0;
      }
    }
    firstX = x;
    s = nextS;
  }
  return hasPower;
}

function burnedLineEnd(runs: ReadonlyArray<RasterPixelRun>, first: number): number {
  let end = first + 1;
  if ((runs[first]?.s ?? 0) <= 0) return end;
  while (end < runs.length && (runs[end]?.s ?? 0) > 0) end += 1;
  return end;
}

function appendLineSweepRuns(
  sweepRuns: RasterSweepRun[],
  runs: ReadonlyArray<RasterPixelRun>,
  first: number,
  end: number,
  geometry: RasterRunGeometry,
): void {
  const firstRun = runs[first];
  const lastRun = runs[end - 1];
  if (firstRun === undefined || lastRun === undefined) return;
  const lineStartX = runSweepExtent(firstRun, geometry).startXWorldMm;
  const lineEndX = runSweepExtent(lastRun, geometry).endXWorldMm;
  const edges =
    firstRun.s > 0 && geometry.dotWidthCorrectionMm > 0
      ? survivingBurnEdges(lineStartX, lineEndX, geometry)
      : undefined;
  if (edges === null) {
    sweepRuns.push({ startXWorldMm: lineStartX, endXWorldMm: lineEndX, s: 0 });
    return;
  }
  if (edges !== undefined) {
    sweepRuns.push({ startXWorldMm: lineStartX, endXWorldMm: edges.burnStartX, s: 0 });
  }
  for (let index = first; index < end; index += 1) {
    const run = runs[index];
    if (run === undefined) continue;
    const extent = runSweepExtent(run, geometry);
    const burned = edges === undefined ? extent : burnedPart(extent, edges, geometry.isReverse);
    if (burned !== null) sweepRuns.push(burned);
  }
  if (edges !== undefined) {
    sweepRuns.push({ startXWorldMm: edges.burnEndX, endXWorldMm: lineEndX, s: 0 });
  }
}

function reportLostRuns(
  line: ReadonlyArray<RasterPixelRun>,
  geometry: RasterRunGeometry,
  onLost: (firstX: number, endX: number) => void,
): void {
  const leftRun = line[0];
  const rightRun = line[line.length - 1];
  if (leftRun === undefined || rightRun === undefined || geometry.dotWidthCorrectionMm <= 0) {
    return;
  }
  const edges = survivingBurnEdges(
    runSweepExtent(geometry.isReverse ? rightRun : leftRun, geometry).startXWorldMm,
    runSweepExtent(geometry.isReverse ? leftRun : rightRun, geometry).endXWorldMm,
    geometry,
  );
  for (const run of line) {
    if (
      edges === null ||
      burnedPart(runSweepExtent(run, geometry), edges, geometry.isReverse) === null
    ) {
      onLost(run.firstX, run.lastX + 1);
    }
  }
}

function runSweepExtent(run: RasterPixelRun, geometry: RasterRunGeometry): RasterSweepRun {
  const { pixelWidthMm, isReverse, minXWorldMm } = geometry;
  // Keep the emitter's historical operation order: add minX to the pixel
  // edge before applying DWC. Reassociation can cross a 0.001 mm boundary.
  const leftX = minXWorldMm + run.firstX * pixelWidthMm;
  const rightX = minXWorldMm + (run.lastX + 1) * pixelWidthMm;
  return {
    startXWorldMm: isReverse ? rightX : leftX,
    endXWorldMm: isReverse ? leftX : rightX,
    s: run.s,
  };
}

/** The part of a powered run inside its line's corrected burn, or null when none is left. */
function burnedPart(
  run: RasterSweepRun,
  edges: BurnEdges,
  isReverse: boolean,
): RasterSweepRun | null {
  const later = isReverse ? Math.min : Math.max;
  const earlier = isReverse ? Math.max : Math.min;
  const startXWorldMm = later(run.startXWorldMm, edges.burnStartX);
  const endXWorldMm = earlier(run.endXWorldMm, edges.burnEndX);
  const survives = isReverse ? startXWorldMm > endXWorldMm : startXWorldMm < endXWorldMm;
  return survives ? { startXWorldMm, endXWorldMm, s: run.s } : null;
}

function survivingBurnEdges(
  startXWorldMm: number,
  endXWorldMm: number,
  geometry: RasterRunGeometry,
): BurnEdges | null {
  const { isReverse, dotWidthCorrectionMm } = geometry;
  const burnStartX = startXWorldMm + (isReverse ? -dotWidthCorrectionMm : dotWidthCorrectionMm);
  const burnEndX = endXWorldMm + (isReverse ? dotWidthCorrectionMm : -dotWidthCorrectionMm);
  const shouldSurvive = isReverse ? burnStartX > burnEndX : burnStartX < burnEndX;
  return shouldSurvive ? { burnStartX, burnEndX } : null;
}
import type { RasterPowerValues } from '../raster/raster-power-values';
