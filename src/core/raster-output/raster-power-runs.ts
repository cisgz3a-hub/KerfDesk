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

/** Geometry and correction inputs for one exact-power raster run. */
export type RasterSweepRunsForPixelRunInput = {
  readonly run: RasterPixelRun;
  readonly pixelWidthMm: number;
  readonly isReverse: boolean;
  readonly dotWidthCorrectionMm: number;
  readonly minXWorldMm: number;
};

/** Split an inclusive raster span whenever its exact S value changes. */
export function rasterPixelRuns(row: Uint16Array, span: RasterPixelSpan): RasterPixelRun[] {
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

/** Expand one exact-power pixel run into its dot-width-corrected G1 moves. */
export function rasterSweepRunsForPixelRun(
  input: RasterSweepRunsForPixelRunInput,
): RasterSweepRun[] {
  const { run, pixelWidthMm, isReverse, dotWidthCorrectionMm, minXWorldMm } = input;
  // Keep the emitter's historical operation order: add minX to the pixel
  // edge before applying DWC. Reassociation can cross a 0.001 mm boundary.
  const leftX = minXWorldMm + run.firstX * pixelWidthMm;
  const rightX = minXWorldMm + (run.lastX + 1) * pixelWidthMm;
  const startX = isReverse ? rightX : leftX;
  const endX = isReverse ? leftX : rightX;
  if (run.s <= 0 || dotWidthCorrectionMm <= 0) {
    return [{ startXWorldMm: startX, endXWorldMm: endX, s: run.s }];
  }

  const burnStartX = startX + (isReverse ? -dotWidthCorrectionMm : dotWidthCorrectionMm);
  const burnEndX = endX + (isReverse ? dotWidthCorrectionMm : -dotWidthCorrectionMm);
  if (!rasterRunSurvivesDotWidthCorrection(startX, endX, isReverse, dotWidthCorrectionMm)) {
    return [{ startXWorldMm: startX, endXWorldMm: endX, s: 0 }];
  }
  return [
    { startXWorldMm: startX, endXWorldMm: burnStartX, s: 0 },
    { startXWorldMm: burnStartX, endXWorldMm: burnEndX, s: run.s },
    { startXWorldMm: burnEndX, endXWorldMm: endX, s: 0 },
  ];
}

/** True when dot-width correction leaves a positive-width burn segment. */
export function rasterRunSurvivesDotWidthCorrection(
  startXWorldMm: number,
  endXWorldMm: number,
  isReverse: boolean,
  dotWidthCorrectionMm: number,
): boolean {
  if (dotWidthCorrectionMm <= 0) return true;
  const burnStartX = startXWorldMm + (isReverse ? -dotWidthCorrectionMm : dotWidthCorrectionMm);
  const burnEndX = endXWorldMm + (isReverse ? dotWidthCorrectionMm : -dotWidthCorrectionMm);
  return isReverse ? burnStartX > burnEndX : burnStartX < burnEndX;
}
