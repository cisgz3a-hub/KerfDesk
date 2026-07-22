// Shared raster row geometry for the emitter, route preview, and duration
// model. Wide white gaps become separate sweeps. At an internal split, the
// previous sweep stops at its burn edge and the next entry runway is bounded
// by the gap, so neither forward nor reverse motion can double back.

const RASTER_GAP_RAPID_THRESHOLD_MM = 5;

export type RasterActiveSpan = {
  readonly firstX: number;
  readonly lastX: number;
};

export type RasterRowSweepPlan = {
  readonly span: RasterActiveSpan;
  readonly leadInMm: number;
  readonly leadOutMm: number;
  /** Ordered G1 motion inside the active span, in world millimetres. */
  readonly runs: ReadonlyArray<RasterSweepRun>;
};

export type RasterSweepRun = {
  readonly startXWorldMm: number;
  readonly endXWorldMm: number;
  readonly s: number;
};

/** True when dot-width correction leaves a positive-width burn segment. */
export function rasterRunSurvivesDotWidthCorrection(
  startXWorldMm: number,
  endXWorldMm: number,
  reverse: boolean,
  dotWidthCorrectionMm: number,
): boolean {
  if (dotWidthCorrectionMm <= 0) return true;
  const burnStartX = startXWorldMm + (reverse ? -dotWidthCorrectionMm : dotWidthCorrectionMm);
  const burnEndX = endXWorldMm + (reverse ? dotWidthCorrectionMm : -dotWidthCorrectionMm);
  return reverse ? burnStartX > burnEndX : burnStartX < burnEndX;
}

type RasterActiveSpanInput = {
  readonly row: Uint16Array;
  readonly pixelWidthMm: number;
};

type RasterRowSweepPlanInput = RasterActiveSpanInput & {
  readonly overscanMm: number;
  readonly reverse: boolean;
  readonly dotWidthCorrectionMm?: number;
  /** Raster bounds.minX. Defaults to zero for span-only consumers. */
  readonly minXWorldMm?: number;
};

type RasterPixelRun = {
  readonly firstX: number;
  readonly lastX: number;
  readonly s: number;
};

type BoundedSplitRunwayInput = {
  readonly index: number;
  readonly count: number;
  readonly requestedMm: number;
  readonly gapBeforeMm: number;
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
  return ordered.map((span, index) => {
    const previous = ordered[index - 1];
    const gapBeforeMm =
      previous === undefined
        ? requestedMm
        : gapBetweenSpansMm(previous, span, input.pixelWidthMm, input.reverse);
    return {
      span,
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
      }),
    };
  });
}

function planRasterSweepRuns(
  row: Uint16Array,
  span: RasterActiveSpan,
  pixelWidthMm: number,
  reverse: boolean,
  dotWidthCorrectionMm: number,
  minXWorldMm: number,
): RasterSweepRun[] {
  const pixelRuns = rasterPixelRuns(row, span);
  const orderedRuns = reverse ? [...pixelRuns].reverse() : pixelRuns;
  return orderedRuns.flatMap((run) =>
    rasterSweepRunsForPixelRun(run, pixelWidthMm, reverse, dotWidthCorrectionMm, minXWorldMm),
  );
}

function rasterPixelRuns(row: Uint16Array, span: RasterActiveSpan): RasterPixelRun[] {
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

function rasterSweepRunsForPixelRun(
  run: RasterPixelRun,
  pixelWidthMm: number,
  reverse: boolean,
  dotWidthCorrectionMm: number,
  minXWorldMm: number,
): RasterSweepRun[] {
  // Keep the emitter's historical operation order: add minX to the pixel
  // edge before applying DWC. Reassociating these floating-point additions
  // can move a half-thousandth endpoint onto the other side of toFixed(3).
  const leftX = minXWorldMm + run.firstX * pixelWidthMm;
  const rightX = minXWorldMm + (run.lastX + 1) * pixelWidthMm;
  const startX = reverse ? rightX : leftX;
  const endX = reverse ? leftX : rightX;
  if (run.s <= 0 || dotWidthCorrectionMm <= 0) {
    return [{ startXWorldMm: startX, endXWorldMm: endX, s: run.s }];
  }

  const burnStartX = startX + (reverse ? -dotWidthCorrectionMm : dotWidthCorrectionMm);
  const burnEndX = endX + (reverse ? dotWidthCorrectionMm : -dotWidthCorrectionMm);
  const correctedRunExists = rasterRunSurvivesDotWidthCorrection(
    startX,
    endX,
    reverse,
    dotWidthCorrectionMm,
  );
  if (!correctedRunExists) {
    return [{ startXWorldMm: startX, endXWorldMm: endX, s: 0 }];
  }
  return [
    { startXWorldMm: startX, endXWorldMm: burnStartX, s: 0 },
    { startXWorldMm: burnStartX, endXWorldMm: burnEndX, s: run.s },
    { startXWorldMm: burnEndX, endXWorldMm: endX, s: 0 },
  ];
}

export function rasterControllerCoordinateMm(value: number): number {
  return Number(value.toFixed(3));
}

export function boundedSplitRunwayLengths(
  input: BoundedSplitRunwayInput,
): Pick<RasterRowSweepPlan, 'leadInMm' | 'leadOutMm'> {
  const requestedMm = Math.max(0, input.requestedMm);
  const gapBeforeMm = Math.max(0, input.gapBeforeMm);
  return {
    leadInMm: input.index === 0 ? requestedMm : Math.min(requestedMm, gapBeforeMm),
    leadOutMm: input.index === input.count - 1 ? requestedMm : 0,
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
