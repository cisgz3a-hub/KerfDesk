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
//     After a constant-power (M3) group the caller defers that opening past
//     the first row's laser-off travel (`deferredEntry`, OR-1).
//   - Pixel rows sweep bidirectionally: active rows alternate
//     left-to-right, then right-to-left. Run-length compression: a G1
//     emits only when the dithered S changes from the previous pixel,
//     so a row of identical S values becomes one G1, and a checker
//     pattern becomes N G1s. The X coordinate on each G1 is the far
//     edge of the run in the current sweep direction.
//   - Overscan: each row keeps full entry and exit runways around its outer
//     ink bounds. Wide internal gaps share bounded exit and entry runways so
//     the head can brake dark without reversing over a completed island.
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

import { effectiveGcodeFeedMmPerMin, formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { planRasterRowSweeps } from './raster-sweep-plan';
import { emitSpanSweep } from './emit-raster-sweep';
import { rasterRowLine } from './emit-raster-row-line';
import { isAlongXScan, rasterScanFrame } from './raster-scan-frame';
import type { RasterControllerHead } from './emit-raster-travel';
import type { RasterRowProviderOrder } from '../job/job';
import type { RasterPowerValues } from './raster-power-values';

const DECIMAL_PLACES = 3;
const LINE_END = '\n';

function fmt(n: number): string {
  return n.toFixed(DECIMAL_PLACES);
}

export type EmitRasterInput = {
  // Dithered S-values, one per pixel, row-major. Length must equal
  // width * height. Each value is in [0, sMax] — the caller (the
  // dither module) has already applied the power scale.
  readonly sValues: RasterPowerValues;
  readonly rowProvider?: (y: number) => RasterPowerValues;
  readonly rowProviderOrder?: RasterRowProviderOrder;
  readonly width: number;
  readonly height: number;
  // World bounds of the image in mm. The image is rendered with its
  // top-left at (minX, minY) and bottom-right at (maxX, maxY); the
  // emitter does not apply any transform (the caller bakes that in),
  // except the scan angle's rotation below.
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
  // ADR-492: rows run at this angle; `bounds` and every per-row distance are in
  // the scan frame and each move is rotated into machine X/Y. Absent = along X.
  readonly scanAngleDeg?: number;
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
  // Spell sweep motion compactly (ADR-332): hold the modal G1, hold an
  // unchanged axis, trim trailing zeros, drop the spaces between words. Halves
  // the bytes of a dithered row without moving the head one micron. Defaults
  // off so the conservative dialects and existing callers keep their bytes.
  readonly compactMotionWords?: boolean;
  readonly modalFeedrate?: boolean;
  readonly emitSOnEveryBurnMove?: boolean;
  readonly controlledLaserOffTravelFeedMmPerMin?: number;
  // Optional comment fields written above the data for the operator
  // (and the job-time estimator). Same shape as grbl-strategy emits.
  readonly layerId?: string;
  readonly color?: string;
  readonly powerPercent?: number;
  /** Deterministic compiler-owned facts for an object-local operation override. */
  readonly effectiveOperationComment?: string;
  /** Previous group's known controller position, including across blank groups. */
  readonly initialHead?: RasterControllerHead;
  /**
   * The preceding constant-power (M3) group may have left the beam lit
   * (2026-09-25 controller audit, OR-1). The group's opening `M5` and arm then
   * follow its first laser-off travel, after `entryLines` (the caller's held
   * mode and air changes), so the planner drain they force happens dark.
   */
  readonly deferredEntry?: { readonly entryLines: ReadonlyArray<string> };
  /**
   * When an M3 group ends on a burn, leave its closing `M5` to the caller, which
   * writes it after the next laser-off move (OR-1). The result reports it.
   */
  readonly deferClosingM5WhenLit?: boolean;
};

export type RasterGroupEnd = {
  /** The closing `M5` was left to the caller (see `deferClosingM5WhenLit`). */
  readonly closingM5Deferred: boolean;
  readonly head: RasterControllerHead | null;
  /** A blank group may never have reached a dark move for its held opening. */
  readonly deferredEntryLines: ReadonlyArray<string>;
};

export function emitRasterGroup(input: EmitRasterInput): string {
  return [...emitRasterGroupChunks(input)].join('');
}

/** The group's G-code together with how it ended. */
export function emitRasterGroupWithEnd(
  input: EmitRasterInput,
): RasterGroupEnd & { readonly gcode: string } {
  const chunks: string[] = [];
  const generator = emitRasterGroupChunks(input);
  let next = generator.next();
  while (next.done !== true) {
    chunks.push(next.value);
    next = generator.next();
  }
  return { gcode: chunks.join(''), ...next.value };
}

type RasterEmissionState = {
  /** Opening lines still waiting for the first laser-off travel (OR-1). */
  heldOpening: ReadonlyArray<string> | null;
  /** Under M3, the last written line is a burn: a stop now would be lit. */
  endsLit: boolean;
  /** Where the group's previous sweep left the head. */
  head: RasterControllerHead | null;
};

export function* emitRasterGroupChunks(input: EmitRasterInput): Generator<string, RasterGroupEnd> {
  validate(input);
  yield `${headerComment(input)}${LINE_END}`;
  // M5 first so we don't get stuck in M3 from a preceding cut group.
  // Then M4 S0 to arm dynamic-power mode at zero output.
  const opening = ['M5', `${input.laserModeCommand ?? 'M4'} S0`];
  const state: RasterEmissionState = {
    heldOpening: heldOpeningLines(input, opening),
    endsLit: input.deferredEntry !== undefined,
    head: input.initialHead ?? null,
  };
  if (state.heldOpening === null) yield `${opening.join(LINE_END)}${LINE_END}`;
  yield* emitRasterPasses(input, state);
  if (state.endsLit && input.deferClosingM5WhenLit === true) {
    return {
      closingM5Deferred: true,
      head: state.head,
      deferredEntryLines: state.heldOpening ?? [],
    };
  }
  // Without a caller-owned handoff, the group owns its final shutdown too.
  if (state.heldOpening !== null) yield `${state.heldOpening.join(LINE_END)}${LINE_END}`;
  // Trailing M5 so any subsequent cut group starts from a known
  // mode-off state. The cut group will re-issue its own M3.
  yield `M5${LINE_END}`;
  return { closingM5Deferred: false, head: state.head, deferredEntryLines: [] };
}

function* emitRasterPasses(input: EmitRasterInput, state: RasterEmissionState): Generator<string> {
  const feed = effectiveGcodeFeedMmPerMin(input.feedMmPerMin);
  const pixelWidthMm = (input.bounds.maxX - input.bounds.minX) / input.width;
  const pixelHeightMm = (input.bounds.maxY - input.bounds.minY) / input.height;
  const dotWidthCorrectionMm = Math.max(0, input.dotWidthCorrectionMm ?? 0);
  const passes = normalizedPasses(input.passes);
  const scanFrame = rasterScanFrame(input.scanAngleDeg);
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
    for (const { rowIndex, row } of inputRowsInProviderOrder(input)) {
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
      const line = rasterRowLine(scanFrame, input.bounds.minY + (rowIndex + 0.5) * pixelHeightMm);
      for (const sweepPlan of sweepPlans) {
        // Each island is its own sweep. Internal exits and entries share the
        // blank gap without overlap; any remainder is positioning travel.
        // F rides only the very first G1 of the whole group.
        const sweep = emitSpanSweep(
          input,
          line,
          pixelWidthMm,
          feed,
          !feedEmitted,
          reverse,
          sweepPlan,
          dotWidthCorrectionMm,
          state.head,
          state.heldOpening !== null,
        );
        // A sweep that disappears on the controller grid changes no modal
        // state. In particular, the preceding M3 burn can still be lit.
        if (sweep.lines.length === 0) continue;
        yield sweepText(sweep.lines, state);
        state.endsLit = sweep.endsLit;
        state.head = sweep.head;
        feedEmitted ||= sweep.feedEmitted;
      }
      emittedRowCount += 1;
    }
  }
}

function heldOpeningLines(
  input: EmitRasterInput,
  opening: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  const entry = input.deferredEntry;
  if (entry === undefined) return null;
  return [...entry.entryLines, ...opening];
}

// The first sweep's travel is the group's first laser-off move: a held opening
// follows it (OR-1).
function sweepText(lines: ReadonlyArray<string>, state: RasterEmissionState): string {
  const heldOpening = state.heldOpening;
  if (heldOpening === null) return `${lines.join(LINE_END)}${LINE_END}`;
  state.heldOpening = null;
  const [travel, ...rest] = lines;
  return [travel, ...heldOpening, ...rest].join(LINE_END) + LINE_END;
}

function* inputRowsInProviderOrder(
  input: EmitRasterInput,
): Generator<{ readonly rowIndex: number; readonly row: RasterPowerValues }> {
  for (let sourceY = 0; sourceY < input.height; sourceY += 1) {
    const row =
      input.rowProvider === undefined
        ? input.sValues.subarray(sourceY * input.width, (sourceY + 1) * input.width)
        : input.rowProvider(sourceY);
    if (input.rowProvider !== undefined) {
      if (row.length !== input.width) {
        throw new Error(
          `emitRasterGroup: row provider returned ${row.length} values; expected ${input.width}`,
        );
      }
    }
    yield {
      rowIndex: input.rowProviderOrder === 'descending-y' ? input.height - 1 - sourceY : sourceY,
      row,
    };
  }
}

function headerComment(input: EmitRasterInput): string {
  const layer = input.layerId ?? '?';
  const color = input.color ?? '?';
  const power = input.powerPercent ?? '?';
  return [
    `; image layer ${layer} color ${color} power ${power}%`,
    // ASCII only: GRBL runs any byte above 0x7F as a realtime command.
    `; ${input.width} x ${input.height} px, ${fmt(input.bounds.maxX - input.bounds.minX)} x ${fmt(input.bounds.maxY - input.bounds.minY)} mm`,
    `; feed ${formatGcodeFeedMmPerMin(input.feedMmPerMin)} mm/min, overscan ${fmt(input.overscanMm)} mm, dot width correction ${fmt(input.dotWidthCorrectionMm ?? 0)} mm`,
    ...scanAngleComment(input.scanAngleDeg),
    ...(input.effectiveOperationComment === undefined
      ? []
      : [`; ${input.effectiveOperationComment}`]),
  ].join(LINE_END);
}

// Sizes above are along and across the scan when it runs at an angle.
function scanAngleComment(scanAngleDeg: number | undefined): ReadonlyArray<string> {
  const frame = rasterScanFrame(scanAngleDeg);
  if (isAlongXScan(frame)) return [];
  return [`; scan angle ${Number(frame.angleDeg.toFixed(3))} deg`];
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
