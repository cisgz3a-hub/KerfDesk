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
//   - Overscan: each row keeps full entry and exit runways around its outer
//     ink bounds. Wide internal gaps use one bounded entry runway so the head
//     never reverses over a completed island. All runways keep the laser off.
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

import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import {
  planRasterRowSweeps,
  rasterControllerCoordinateMm,
  type RasterRowSweepPlan,
} from './raster-sweep-plan';

const DECIMAL_PLACES = 3;
const LINE_END = '\n';

function fmt(n: number): string {
  return n.toFixed(DECIMAL_PLACES);
}

export type EmitRasterInput = {
  // Dithered S-values, one per pixel, row-major. Length must equal
  // width * height. Each value is in [0, sMax] — the caller (the
  // dither module) has already applied the power scale.
  readonly sValues: Uint16Array;
  readonly rowProvider?: (y: number) => Uint16Array;
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
  // ADR-052 bidirectional scan-lag compensation. Applied to reverse rows only.
  readonly scanOffsetMm?: number;
  readonly bidirectional?: boolean;
  readonly laserModeCommand?: 'M3' | 'M4';
  readonly modalFeedrate?: boolean;
  readonly emitSOnEveryBurnMove?: boolean;
  readonly controlledLaserOffTravelFeedMmPerMin?: number;
  // Optional comment fields written above the data for the operator
  // (and the job-time estimator). Same shape as grbl-strategy emits.
  readonly layerId?: string;
  readonly color?: string;
  readonly powerPercent?: number;
};

export function emitRasterGroup(input: EmitRasterInput): string {
  return [...emitRasterGroupChunks(input)].join('');
}

export function* emitRasterGroupChunks(input: EmitRasterInput): Generator<string> {
  validate(input);
  yield `${headerComment(input)}${LINE_END}`;
  // M5 first so we don't get stuck in M3 from a preceding cut group.
  // Then M4 S0 to arm dynamic-power mode at zero output.
  yield `M5${LINE_END}`;
  yield `${input.laserModeCommand ?? 'M4'} S0${LINE_END}`;
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
    if (passes > 1) yield `; raster pass ${pass + 1} of ${passes}${LINE_END}`;
    let emittedRowCount = 0;
    let feedEmitted = false;
    for (let y = 0; y < input.height; y += 1) {
      const row = inputRow(input, y);
      // Snake direction alternates per emitted ROW; within a reverse row the
      // ink islands sweep right-to-left too.
      const reverse = (input.bidirectional ?? true) && emittedRowCount % 2 === 1;
      const sweepPlans = planRasterRowSweeps({
        row,
        pixelWidthMm,
        overscanMm: input.overscanMm,
        reverse,
        dotWidthCorrectionMm,
        minXWorldMm: input.bounds.minX,
      });
      if (sweepPlans.length === 0) continue;
      const worldY = input.bounds.minY + (y + 0.5) * pixelHeightMm;
      for (const sweepPlan of sweepPlans) {
        // Each island is its own sweep. Internal exits stop at the burn edge;
        // the next bounded lead-in crosses the remainder with the laser off —
        // the raster analogue of ADR-035 (ADR-039), without path reversal.
        // F rides only the very first G1 of the whole group.
        yield `${emitSpanSweep(
          input,
          worldY,
          pixelWidthMm,
          feed,
          !feedEmitted,
          reverse,
          sweepPlan,
          dotWidthCorrectionMm,
        )}${LINE_END}`;
        feedEmitted = true;
      }
      emittedRowCount += 1;
    }
  }
  // Trailing M5 so any subsequent cut group starts from a known
  // mode-off state. The cut group will re-issue its own M3.
  yield `M5${LINE_END}`;
}

function inputRow(input: EmitRasterInput, y: number): Uint16Array {
  if (input.rowProvider !== undefined) {
    const row = input.rowProvider(y);
    if (row.length !== input.width) {
      throw new Error(
        `emitRasterGroup: row provider returned ${row.length} values; expected ${input.width}`,
      );
    }
    return row;
  }
  const start = y * input.width;
  return input.sValues.subarray(start, start + input.width);
}

function emitSpanSweep(
  input: EmitRasterInput,
  worldY: number,
  pixelWidthMm: number,
  feed: number,
  emitFeed: boolean,
  reverse: boolean,
  sweepPlan: RasterRowSweepPlan,
  dotWidthCorrectionMm: number,
): string {
  const lines: string[] = [];
  const span = sweepPlan.span;
  // Sweep extents are the ACTIVE span's pixel edges plus overscan,
  // not the full image bounds. For a row with content only in cols
  // 40..60 of a 200-col image, the head only visits world X from
  // (minX + 40*pw - overscan) to (minX + 61*pw + overscan).
  const activeStartX = input.bounds.minX + span.firstX * pixelWidthMm;
  const activeEndX = input.bounds.minX + (span.lastX + 1) * pixelWidthMm;
  const startX = reverse ? activeEndX + sweepPlan.leadInMm : activeStartX - sweepPlan.leadInMm;
  const endX = reverse ? activeStartX - sweepPlan.leadOutMm : activeEndX + sweepPlan.leadOutMm;
  const rowShiftX = reverse ? -(input.scanOffsetMm ?? 0) : 0;
  // Rapid into the overscan zone, laser off (M4 + S0 → diode dark).
  lines.push(
    formatLaserOffTravel(startX + rowShiftX, worldY, input.controlledLaserOffTravelFeedMmPerMin),
  );
  let prevS = -1;
  // The controller only sees three-decimal coordinates. Track that formatted
  // head position so a positive-power fragment which exists in floating-point
  // geometry, but collapses on the controller grid, is never armed in place.
  let controllerHeadX = rasterControllerCoordinateMm(startX + rowShiftX);
  // A controlled G1 seek changes modal F, unlike G0. Reassert the engraving
  // feed on the first runway/burn move after every such seek.
  let shouldEmitFeed = emitFeed || input.controlledLaserOffTravelFeedMmPerMin !== undefined;
  const pushRun = (x: number, s: number): void => {
    const targetX = x + rowShiftX;
    const controllerTargetX = rasterControllerCoordinateMm(targetX);
    if (s > 0 && controllerTargetX === controllerHeadX) return;
    lines.push(
      formatRunG1(
        targetX,
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
    controllerHeadX = controllerTargetX;
  };
  if (sweepPlan.leadInMm > 0) {
    pushRun(reverse ? activeEndX : activeStartX, 0);
  }
  for (const run of sweepPlan.runs) {
    pushRun(run.endXWorldMm, run.s);
  }
  // Exit overscan with S0 so the diode is dark during deceleration. The
  // corrected path already emits a final S0 at the active edge when overscan is
  // disabled; avoid a duplicate zero-length move in that case.
  if (sweepPlan.leadOutMm > 0 || dotWidthCorrectionMm <= 0) {
    lines.push(formatLaserOffG1(endX + rowShiftX, feed, input.modalFeedrate ?? true));
  }
  return lines.join(LINE_END);
}

function formatLaserOffTravel(x: number, y: number, controlledFeed: number | undefined): string {
  if (controlledFeed !== undefined) {
    return `G1 X${fmt(x)} Y${fmt(y)} F${Math.max(1, Math.round(controlledFeed))} S0 ; ${INTENTIONAL_LASER_OFF_MOTION_COMMENT}`;
  }
  return `G0 X${fmt(x)} Y${fmt(y)} S0`;
}

function formatLaserOffG1(x: number, feed: number, modalFeedrate: boolean): string {
  const feedWord = modalFeedrate ? '' : ` F${feed}`;
  return `G1 X${fmt(x)}${feedWord} S0`;
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
  if (s !== prevS || emitSOnEveryBurnMove) parts.push(`S${s}`);
  return parts.join(' ');
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

// Split out to keep validate() under the cyclomatic-complexity cap. Finite-check
// BEFORE the ordering compares: `NaN <= minX` is false, so a NaN bound would
// otherwise slip through and reach fmt(NaN) → "XNaN" in the G-code (audit C4).
function validateBounds(bounds: EmitRasterInput['bounds']): void {
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new Error('emitRasterGroup: bounds must be finite');
  }
  if (maxX <= minX || maxY <= minY) {
    throw new Error('emitRasterGroup: bounds must be positive');
  }
}

function validate(input: EmitRasterInput): void {
  if (input.width <= 0 || input.height <= 0) {
    throw new Error(`emitRasterGroup: invalid dimensions ${input.width}×${input.height}`);
  }
  if (input.rowProvider === undefined && input.sValues.length !== input.width * input.height) {
    throw new Error(
      `emitRasterGroup: sValues length ${input.sValues.length} does not match ${input.width}×${input.height}`,
    );
  }
  validateBounds(input.bounds);
  if (!isPositiveFinite(input.feedMmPerMin)) {
    throw new Error('emitRasterGroup: feedMmPerMin must be finite and > 0');
  }
  if (!Number.isFinite(input.overscanMm) || input.overscanMm < 0) {
    throw new Error('emitRasterGroup: overscanMm must be >= 0');
  }
  if ((input.dotWidthCorrectionMm ?? 0) < 0) {
    throw new Error('emitRasterGroup: dotWidthCorrectionMm must be >= 0');
  }
  if (!Number.isFinite(input.scanOffsetMm ?? 0)) {
    throw new Error('emitRasterGroup: scanOffsetMm must be finite');
  }
  validateControlledLaserOffTravelFeed(input.controlledLaserOffTravelFeedMmPerMin);
}

function validateControlledLaserOffTravelFeed(value: number | undefined): void {
  if (value !== undefined && !isPositiveFinite(value)) {
    throw new Error('emitRasterGroup: controlled laser-off travel feed must be finite and > 0');
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizedPasses(passes: number | undefined): number {
  return Math.max(1, Math.floor(passes ?? 1));
}
