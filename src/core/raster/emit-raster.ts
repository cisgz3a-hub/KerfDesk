// emit-raster — Phase F.2.b pure G-code emitter for an image-mode
// group. Takes the dither output (per-pixel S-values), the image's
// mm-bounds, and run parameters; returns deterministic GRBL G-code.
//
// Algorithm per ADR-020 Q1 (M4 hardcoded for image groups) + Q3
// (streaming threshold deferred — v1 emits a complete string):
//
//   - Preamble emits `M5` + `M4 S0` at the start of the group so the
//     controller flips into dynamic-power mode before the first burn.
//     Cut groups in the same job re-issue their own M3 at start; the
//     dispatcher (compile-job in F.2.d) is responsible for ordering.
//   - Pixel rows sweep bidirectionally: active rows alternate
//     left-to-right, then right-to-left. Run-length compression: a G1
//     emits only when the dithered S changes from the previous pixel,
//     so a row of identical S values becomes one G1, and a checker
//     pattern becomes N G1s. The X coordinate on each G1 is the far
//     edge of the run in the current sweep direction.
//   - Overscan: each row's rapid arrives `overscanMm` to the left of
//     bounds.minX, then sweeps past bounds.maxX by `overscanMm` with
//     S0 on the exit. Gives the head room to accelerate / decelerate
//     with the laser off so corners don't over-burn.
//   - S=0 pixels (white in the source) emit normally — they're part
//     of the sweep but the dynamic-power M4 controller automatically
//     keeps the diode dark when S=0.
//
// Pure-core compliant: no clock, no random, no I/O. Same input +
// same options → byte-identical G-code (determinism invariant #5).
//
// Future improvements (out of F.2.b v1):
//   - Async-iterable emit for >100 KB jobs (ADR-020 Q3 threshold).
//   - Per-pixel feed modulation for grayscale-on-non-M4 controllers.

const DECIMAL_PLACES = 3;
const LINE_END = '\n';

// A white gap WIDER than this between two ink islands on one raster row is
// crossed with a G0 rapid (laser hard-off) instead of a slow G1 S0 feed move:
// the raster analogue of ADR-035's fill gap-rapid split (ADR-039). 5 mm matches
// the fill threshold and the long-blank-feed preflight (P0-A) so fresh raster
// output passes that invariant. Smaller interior gaps stay within one sweep,
// blanked at feed as before.
const RASTER_GAP_RAPID_THRESHOLD_MM = 5;

function fmt(n: number): string {
  return n.toFixed(DECIMAL_PLACES);
}

export type EmitRasterInput = {
  // Dithered S-values, one per pixel, row-major. Length must equal
  // width * height. Each value is in [0, sMax] — the caller (the
  // dither module) has already applied the power scale.
  readonly sValues: Uint16Array;
  readonly width: number;
  readonly height: number;
  // World bounds of the image in mm. The image is rendered with its
  // top-left at (minX, minY) and bottom-right at (maxX, maxY); the
  // emitter does not apply any transform (the caller bakes that in).
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  // Feed rate for raster G1s, in mm/min. Constant across the image —
  // M4 controllers modulate power, not speed.
  readonly feedMmPerMin: number;
  readonly passes?: number;
  // Distance to overshoot at each row end, in mm. 5 mm is a typical
  // default for diode lasers; higher feeds want more. 0 disables.
  readonly overscanMm: number;
  // LightBurn-style image Dot Width Correction. Shortens non-zero scan runs
  // at both ends to compensate for beam thickness. 0 disables.
  readonly dotWidthCorrectionMm?: number;
  // Optional comment fields written above the data for the operator
  // (and the job-time estimator). Same shape as grbl-strategy emits.
  readonly layerId?: string;
  readonly color?: string;
  readonly powerPercent?: number;
  readonly laserModeCommand?: 'M3' | 'M4';
  readonly modalFeedrate?: boolean;
  readonly emitSOnEveryBurnMove?: boolean;
  readonly controlledLaserOffTravelFeedMmPerMin?: number | undefined;
};

export function emitRasterGroup(input: EmitRasterInput): string {
  validate(input);
  const chunks: string[] = [];
  chunks.push(headerComment(input));
  // M5 first so we don't get stuck in M3 from a preceding cut group.
  // Then arm the profile-selected raster laser mode at zero output.
  chunks.push('M5');
  chunks.push(`${input.laserModeCommand ?? 'M4'} S0`);
  const feed = Math.round(input.feedMmPerMin);
  const pixelWidthMm = (input.bounds.maxX - input.bounds.minX) / input.width;
  const pixelHeightMm = (input.bounds.maxY - input.bounds.minY) / input.height;
  const dotWidthCorrectionMm = Math.max(0, input.dotWidthCorrectionMm ?? 0);
  const passes = normalizedPasses(input.passes);
  // Body — one row at a time. Three optimizations on top of the naive
  // "sweep every row across the full width" version:
  //   1. Skip rows whose pixels are all S=0. They contribute zero
  //      burn and would otherwise force the head to sweep at feed
  //      across width mm of nothing. For a 200×100 mm banner with
  //      80% of its rows blank, this drops engrave time ~5×.
  //   2. For non-empty rows, clip the sweep to the active span
  //      (first non-zero pixel to last non-zero pixel) plus overscan
  //      on each side. Skipping leading/trailing all-zero pixels
  //      means the head only burns travel where pixels actually exist.
  //   3. Alternate emitted active rows left-to-right / right-to-left so
  //      overscan does not force a full-width return move between rows.
  // The G0 rapid between rows handles arbitrarily-large Y jumps when
  // we skip a band of empty rows — the controller plans an oblique
  // travel from the end of one active row to the start of the next.
  for (let pass = 0; pass < passes; pass += 1) {
    if (passes > 1) chunks.push(`; raster pass ${pass + 1} of ${passes}`);
    let emittedRowCount = 0;
    let feedEmitted = false;
    for (let y = 0; y < input.height; y += 1) {
      const spans = activeSpans(input, y, pixelWidthMm);
      if (spans.length === 0) continue;
      const worldY = input.bounds.minY + (y + 0.5) * pixelHeightMm;
      // Snake direction alternates per emitted ROW; within a reverse row the
      // ink islands sweep right-to-left too.
      const reverse = emittedRowCount % 2 === 1;
      const ordered = reverse ? [...spans].reverse() : spans;
      for (const span of ordered) {
        // Each island is its own sweep, so the G0 lead-in to the NEXT island
        // crosses the wide white gap between them as a rapid (laser off) rather
        // than a slow G1 S0 feed move — the raster analogue of ADR-035 (ADR-039).
        // F rides only the very first G1 of the whole group.
        chunks.push(
          emitSpanSweep(
            input,
            y,
            worldY,
            pixelWidthMm,
            feed,
            !feedEmitted,
            reverse,
            span,
            dotWidthCorrectionMm,
          ),
        );
        feedEmitted = true;
      }
      emittedRowCount += 1;
    }
  }
  // Trailing M5 so any subsequent cut group starts from a known
  // mode-off state. The cut group will re-issue its own M3.
  chunks.push('M5');
  return chunks.join(LINE_END) + LINE_END;
}

type ActiveSpan = { readonly firstX: number; readonly lastX: number };

// The ink islands of one row, each an inclusive [firstX, lastX] column range.
// Consecutive ink separated by a white gap WIDER than
// RASTER_GAP_RAPID_THRESHOLD_MM is split into separate spans, so the emitter
// crosses that gap with a G0 rapid (ADR-039); smaller interior gaps stay within
// one span (blanked at feed, as before). Returns [] for an all-white row.
function activeSpans(input: EmitRasterInput, y: number, pixelWidthMm: number): ActiveSpan[] {
  const rowStart = y * input.width;
  const spans: ActiveSpan[] = [];
  let firstX = -1;
  let lastInk = -1;
  for (let i = 0; i < input.width; i += 1) {
    if ((input.sValues[rowStart + i] ?? 0) === 0) continue;
    if (firstX === -1) {
      firstX = i;
      lastInk = i;
      continue;
    }
    const gapMm = (i - lastInk - 1) * pixelWidthMm;
    if (gapMm > RASTER_GAP_RAPID_THRESHOLD_MM) {
      spans.push({ firstX, lastX: lastInk });
      firstX = i;
    }
    lastInk = i;
  }
  if (firstX !== -1) spans.push({ firstX, lastX: lastInk });
  return spans;
}

function emitSpanSweep(
  input: EmitRasterInput,
  y: number,
  worldY: number,
  pixelWidthMm: number,
  feed: number,
  emitFeed: boolean,
  reverse: boolean,
  span: ActiveSpan,
  dotWidthCorrectionMm: number,
): string {
  const lines: string[] = [];
  // Sweep extents are the ACTIVE span's pixel edges plus overscan,
  // not the full image bounds. For a row with content only in cols
  // 40..60 of a 200-col image, the head only visits world X from
  // (minX + 40*pw - overscan) to (minX + 61*pw + overscan).
  const activeStartX = input.bounds.minX + span.firstX * pixelWidthMm;
  const activeEndX = input.bounds.minX + (span.lastX + 1) * pixelWidthMm;
  const startX = reverse ? activeEndX + input.overscanMm : activeStartX - input.overscanMm;
  const endX = reverse ? activeStartX - input.overscanMm : activeEndX + input.overscanMm;
  // Move into the overscan zone with the laser off (M4 + S0 → diode dark).
  // Most profiles use rapid G0; conservative profiles can force feed-
  // controlled G1 S0 travel to avoid missed steps on weaker gantries.
  lines.push(formatLaserOffTravel(startX, worldY, input.controlledLaserOffTravelFeedMmPerMin));
  let prevS = -1;
  let shouldEmitFeed = emitFeed;
  const pushRun = (x: number, s: number): void => {
    lines.push(
      formatRunG1(
        x,
        s,
        prevS,
        feed,
        shouldEmitFeed,
        input.modalFeedrate ?? true,
        input.emitSOnEveryBurnMove ?? false,
      ),
    );
    shouldEmitFeed = false;
    prevS = s;
  };
  if (input.overscanMm > 0) {
    pushRun(reverse ? activeEndX : activeStartX, 0);
  }
  emitRowRuns(input, y, pixelWidthMm, span, reverse, dotWidthCorrectionMm, pushRun);
  // Exit overscan with S0 so the diode is dark during deceleration. The
  // corrected path already emits a final S0 at the active edge when overscan is
  // disabled; avoid a duplicate zero-length move in that case.
  if (input.overscanMm > 0 || dotWidthCorrectionMm <= 0) {
    lines.push(formatLaserOffG1(endX, feed, input.modalFeedrate ?? true));
  }
  return lines.join(LINE_END);
}

type PushRasterRun = (x: number, s: number) => void;

function emitRowRuns(
  input: EmitRasterInput,
  y: number,
  pixelWidthMm: number,
  span: ActiveSpan,
  reverse: boolean,
  dotWidthCorrectionMm: number,
  pushRun: PushRasterRun,
): void {
  if (dotWidthCorrectionMm > 0) {
    emitCorrectedRowRuns(input, y, pixelWidthMm, span, reverse, dotWidthCorrectionMm, pushRun);
    return;
  }
  if (reverse) {
    emitReverseRowRuns(input, y, pixelWidthMm, span, pushRun);
    return;
  }
  emitForwardRowRuns(input, y, pixelWidthMm, span, pushRun);
}

type RasterRun = {
  readonly firstX: number;
  readonly lastX: number;
  readonly s: number;
};

function emitCorrectedRowRuns(
  input: EmitRasterInput,
  y: number,
  pixelWidthMm: number,
  span: ActiveSpan,
  reverse: boolean,
  dotWidthCorrectionMm: number,
  pushRun: PushRasterRun,
): void {
  const runs = rowRuns(input, y, span);
  if (reverse) {
    emitCorrectedReverseRowRuns(
      input,
      pixelWidthMm,
      [...runs].reverse(),
      dotWidthCorrectionMm,
      pushRun,
    );
    return;
  }
  emitCorrectedForwardRowRuns(input, pixelWidthMm, runs, dotWidthCorrectionMm, pushRun);
}

function rowRuns(input: EmitRasterInput, y: number, span: ActiveSpan): RasterRun[] {
  const rowStart = y * input.width;
  const runs: RasterRun[] = [];
  let firstX = span.firstX;
  let s = input.sValues[rowStart + firstX] ?? 0;
  for (let i = span.firstX + 1; i <= span.lastX; i += 1) {
    const cellS = input.sValues[rowStart + i] ?? 0;
    if (cellS === s) continue;
    runs.push({ firstX, lastX: i - 1, s });
    firstX = i;
    s = cellS;
  }
  runs.push({ firstX, lastX: span.lastX, s });
  return runs;
}

function emitCorrectedForwardRowRuns(
  input: EmitRasterInput,
  pixelWidthMm: number,
  runs: ReadonlyArray<RasterRun>,
  dotWidthCorrectionMm: number,
  pushRun: PushRasterRun,
): void {
  for (const run of runs) {
    const startX = input.bounds.minX + run.firstX * pixelWidthMm;
    const endX = input.bounds.minX + (run.lastX + 1) * pixelWidthMm;
    if (run.s <= 0) {
      pushRun(endX, 0);
      continue;
    }
    const burnStartX = startX + dotWidthCorrectionMm;
    const burnEndX = endX - dotWidthCorrectionMm;
    if (burnEndX <= burnStartX) {
      pushRun(endX, 0);
      continue;
    }
    pushRun(burnStartX, 0);
    pushRun(burnEndX, run.s);
    pushRun(endX, 0);
  }
}

function emitCorrectedReverseRowRuns(
  input: EmitRasterInput,
  pixelWidthMm: number,
  runs: ReadonlyArray<RasterRun>,
  dotWidthCorrectionMm: number,
  pushRun: PushRasterRun,
): void {
  for (const run of runs) {
    const startX = input.bounds.minX + run.firstX * pixelWidthMm;
    const endX = input.bounds.minX + (run.lastX + 1) * pixelWidthMm;
    if (run.s <= 0) {
      pushRun(startX, 0);
      continue;
    }
    const burnStartX = endX - dotWidthCorrectionMm;
    const burnEndX = startX + dotWidthCorrectionMm;
    if (burnStartX <= burnEndX) {
      pushRun(startX, 0);
      continue;
    }
    pushRun(burnStartX, 0);
    pushRun(burnEndX, run.s);
    pushRun(startX, 0);
  }
}

function emitReverseRowRuns(
  input: EmitRasterInput,
  y: number,
  pixelWidthMm: number,
  span: ActiveSpan,
  pushRun: PushRasterRun,
): void {
  let runS = input.sValues[y * input.width + span.lastX] ?? 0;
  for (let i = span.lastX - 1; i >= span.firstX; i -= 1) {
    const cellS = input.sValues[y * input.width + i] ?? 0;
    if (cellS !== runS) {
      pushRun(input.bounds.minX + (i + 1) * pixelWidthMm, runS);
      runS = cellS;
    }
  }
  pushRun(input.bounds.minX + span.firstX * pixelWidthMm, runS);
}

function emitForwardRowRuns(
  input: EmitRasterInput,
  y: number,
  pixelWidthMm: number,
  span: ActiveSpan,
  pushRun: PushRasterRun,
): void {
  let runS = input.sValues[y * input.width + span.firstX] ?? 0;
  for (let i = span.firstX + 1; i <= span.lastX; i += 1) {
    const cellS = input.sValues[y * input.width + i] ?? 0;
    if (cellS !== runS) {
      pushRun(input.bounds.minX + i * pixelWidthMm, runS);
      runS = cellS;
    }
  }
  pushRun(input.bounds.minX + (span.lastX + 1) * pixelWidthMm, runS);
}

// One G1 closing a run. Emits S only when it changed from the
// previous run (G-code is modal). Emits F only on the very first
// G1 of the whole raster — subsequent G1s inherit the feed.
function formatRunG1(
  x: number,
  s: number,
  prevS: number,
  feed: number,
  isVeryFirstG1: boolean,
  modalFeedrate: boolean,
  emitSOnEveryBurnMove: boolean,
): string {
  const parts: string[] = [`G1 X${fmt(x)}`];
  if (isVeryFirstG1 || !modalFeedrate) parts.push(`F${feed}`);
  if (s !== prevS || (s > 0 && emitSOnEveryBurnMove)) parts.push(`S${s}`);
  return parts.join(' ');
}

function formatLaserOffG1(x: number, feed: number, modalFeedrate: boolean): string {
  const parts: string[] = [`G1 X${fmt(x)}`];
  if (!modalFeedrate) parts.push(`F${feed}`);
  parts.push('S0');
  return parts.join(' ');
}

function formatLaserOffTravel(
  x: number,
  y: number,
  controlledFeedMmPerMin: number | undefined,
): string {
  const feed =
    typeof controlledFeedMmPerMin === 'number' &&
    Number.isFinite(controlledFeedMmPerMin) &&
    controlledFeedMmPerMin > 0
      ? Math.round(controlledFeedMmPerMin)
      : null;
  if (feed !== null) return `G1 X${fmt(x)} Y${fmt(y)} F${feed} S0`;
  return `G0 X${fmt(x)} Y${fmt(y)} S0`;
}

function headerComment(input: EmitRasterInput): string {
  const layer = input.layerId ?? '?';
  const color = input.color ?? '?';
  const power = input.powerPercent ?? '?';
  return [
    `; image layer ${layer} color ${color} power ${power}%`,
    `; ${input.width} × ${input.height} px, ${fmt(input.bounds.maxX - input.bounds.minX)} × ${fmt(input.bounds.maxY - input.bounds.minY)} mm`,
    `; feed ${Math.round(input.feedMmPerMin)} mm/min, overscan ${fmt(input.overscanMm)} mm, dot width correction ${fmt(input.dotWidthCorrectionMm ?? 0)} mm`,
  ].join(LINE_END);
}

function validate(input: EmitRasterInput): void {
  if (input.width <= 0 || input.height <= 0) {
    throw new Error(`emitRasterGroup: invalid dimensions ${input.width}×${input.height}`);
  }
  if (input.sValues.length !== input.width * input.height) {
    throw new Error(
      `emitRasterGroup: sValues length ${input.sValues.length} does not match ${input.width}×${input.height}`,
    );
  }
  if (input.bounds.maxX <= input.bounds.minX || input.bounds.maxY <= input.bounds.minY) {
    throw new Error('emitRasterGroup: bounds must be positive');
  }
  if (input.feedMmPerMin <= 0) {
    throw new Error('emitRasterGroup: feedMmPerMin must be > 0');
  }
  if (input.overscanMm < 0) {
    throw new Error('emitRasterGroup: overscanMm must be >= 0');
  }
  if ((input.dotWidthCorrectionMm ?? 0) < 0) {
    throw new Error('emitRasterGroup: dotWidthCorrectionMm must be >= 0');
  }
}

function normalizedPasses(passes: number | undefined): number {
  return Math.max(1, Math.floor(passes ?? 1));
}
