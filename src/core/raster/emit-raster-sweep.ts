// One planned raster sweep, including its controller-grid and modal state.
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import {
  createModalMotionWriter,
  formatMotionCoordinateMm,
  joinMotionWords,
  motionWordStyleFor,
  type ModalMotionWriter,
  type MotionWordStyle,
} from '../gcode/motion-words';
import { rasterControllerCoordinateMm, type RasterRowSweepPlan } from './raster-sweep-plan';
import {
  rasterEntryExcursion,
  rasterSweepOpening,
  type RasterControllerHead,
} from './emit-raster-travel';
import type { EmitRasterInput } from './emit-raster';
type SweepExtents = {
  readonly activeStartX: number;
  readonly activeEndX: number;
  readonly startX: number;
  readonly endX: number;
  readonly rowShiftX: number;
};

// Sweep extents are the ACTIVE span's pixel edges plus overscan, not the full
// image bounds. For a row with content only in cols 40..60 of a 200-col image,
// the head only visits world X from (minX + 40*pw - overscan) to
// (minX + 61*pw + overscan). A reversed sweep runs the other way and carries
// the bidirectional scan offset.
function sweepExtents(
  input: EmitRasterInput,
  pixelWidthMm: number,
  reverse: boolean,
  sweepPlan: RasterRowSweepPlan,
): SweepExtents {
  const span = sweepPlan.span;
  const activeStartX = input.bounds.minX + span.firstX * pixelWidthMm;
  const activeEndX = input.bounds.minX + (span.lastX + 1) * pixelWidthMm;
  return {
    activeStartX,
    activeEndX,
    startX:
      sweepPlan.sharedLeadStartXWorldMm ??
      (reverse ? activeEndX + sweepPlan.leadInMm : activeStartX - sweepPlan.leadInMm),
    endX:
      sweepPlan.sharedLeadEndXWorldMm ??
      (reverse ? activeStartX - sweepPlan.leadOutMm : activeEndX + sweepPlan.leadOutMm),
    rowShiftX: reverse ? -(input.scanOffsetMm ?? 0) : 0,
  };
}

type RasterSweepEmission = {
  readonly lines: ReadonlyArray<string>;
  /** An engraving F word was actually written, rather than only a seek. */
  readonly feedEmitted: boolean;
  /** Under M3 the sweep ends on a burn, so a stop right after it would be lit. */
  readonly endsLit: boolean;
  readonly head: RasterControllerHead;
};

export function emitSpanSweep(
  input: EmitRasterInput,
  worldY: number,
  pixelWidthMm: number,
  feed: number,
  emitFeed: boolean,
  reverse: boolean,
  sweepPlan: RasterRowSweepPlan,
  dotWidthCorrectionMm: number,
  previousHead: RasterControllerHead | null,
  deferredOpening: boolean,
): RasterSweepEmission {
  // Under M3 a motion line that does not move the head drains GRBL's planner
  // with the beam still at the last run's power (GRBL motion_control.c:67-76,
  // grblHAL motion_control.c:182-190), so no zero-length move is written there,
  // laser-off or not (2026-09-25 controller audit, OR-1). Under M4 the stop is
  // dark and the historical bytes stay.
  const constantPower = input.laserModeCommand === 'M3';
  const style = motionWordStyleFor(input.compactMotionWords ?? false);
  // One writer per sweep: every row opens with a travel that states its motion
  // word and both axes, so nothing is ever held across a row boundary. (Only an
  // M3 sweep at a shared runway point skips that travel, on the same row.)
  const writer = createModalMotionWriter(style);
  const { activeStartX, activeEndX, startX, endX, rowShiftX } = sweepExtents(
    input,
    pixelWidthMm,
    reverse,
    sweepPlan,
  );
  // The controller only sees three-decimal coordinates. Track that formatted
  // head position so a positive-power fragment which exists in floating-point
  // geometry, but collapses on the controller grid, is never armed in place.
  const controllerHeadX = rasterControllerCoordinateMm(startX + rowShiftX);
  const controllerY = rasterControllerCoordinateMm(worldY);
  // Rapid into the overscan zone, laser off (M4 + S0 → diode dark).
  const opening = rasterSweepOpening(
    {
      x: startX + rowShiftX,
      y: worldY,
      target: { x: controllerHeadX, y: controllerY },
      previousHead,
      constantPower: constantPower || deferredOpening,
      controlledFeed: input.controlledLaserOffTravelFeedMmPerMin,
    },
    writer,
    style,
  );
  const state: SweepState = {
    lines: [...opening.lines],
    headX: controllerHeadX,
    prevS: opening.prevS,
    // A controlled G1 seek changes F; reassert engraving feed after it.
    feedPending: emitFeed || input.controlledLaserOffTravelFeedMmPerMin !== undefined,
    feedEmitted: false,
    endsOnBurn: false,
  };
  const formatting = { input, feed, writer, style, controllerY, constantPower, deferredOpening };
  const pushRun = (x: number, s: number): void =>
    pushRasterRun(state, x + rowShiftX, s, formatting);
  if (sweepPlan.leadInMm > 0) {
    pushRun(reverse ? activeEndX : activeStartX, 0);
  }
  for (const run of sweepPlan.runs) {
    pushRun(run.endXWorldMm, run.s);
  }
  // Exit overscan with S0 so the diode is dark during deceleration. The
  // corrected path already emits a final S0 at the active edge when overscan is
  // disabled; avoid a duplicate zero-length move in that case. Under M3 a close
  // that would not move the head (no overscan, or an internal island's exit at
  // its burn edge) is left out: the next row's travel or the closing M5 turns
  // the beam off instead.
  closeRasterSweep(
    state,
    endX + rowShiftX,
    sweepPlan.leadOutMm > 0 || dotWidthCorrectionMm <= 0,
    formatting,
  );
  return {
    lines: state.lines,
    feedEmitted: state.feedEmitted,
    endsLit: constantPower && state.endsOnBurn,
    head: { x: state.headX, y: controllerY },
  };
}

type SweepState = {
  readonly lines: string[];
  headX: number;
  prevS: number;
  feedPending: boolean;
  feedEmitted: boolean;
  endsOnBurn: boolean;
};

type SweepFormatting = RasterRunFormatting & {
  readonly controllerY: number;
  readonly constantPower: boolean;
  readonly deferredOpening: boolean;
};

function pushRasterRun(state: SweepState, x: number, s: number, formatting: SweepFormatting): void {
  const target = rasterControllerCoordinateMm(x);
  const previousM3StillLit = formatting.deferredOpening && state.lines.length === 0;
  if ((s > 0 || formatting.constantPower || previousM3StillLit) && target === state.headX) return;
  if (s > 0 && previousM3StillLit) {
    state.lines.push(
      ...rasterEntryExcursion(state.headX, formatting.controllerY, target, formatting),
    );
    state.prevS = 0;
  }
  state.lines.push(formatRunG1(x, s, state.prevS, state.feedPending, formatting));
  state.feedEmitted ||= state.feedPending || formatting.input.modalFeedrate === false;
  state.feedPending = false;
  state.prevS = s;
  state.headX = target;
  state.endsOnBurn = s > 0;
}

function closeRasterSweep(
  state: SweepState,
  x: number,
  wanted: boolean,
  formatting: SweepFormatting,
): void {
  const { input, feed, writer, style, constantPower, deferredOpening } = formatting;
  if (
    !writesRowClose(wanted, constantPower || (deferredOpening && state.lines.length === 0), {
      closeX: x,
      controllerHeadX: state.headX,
    })
  )
    return;
  state.lines.push(
    formatLaserOffG1(x, feed, state.feedPending, input.modalFeedrate ?? true, writer, style),
  );
  state.feedEmitted ||= state.feedPending || input.modalFeedrate === false;
  state.headX = rasterControllerCoordinateMm(x);
  state.endsOnBurn = false;
}

function writesRowClose(
  wanted: boolean,
  constantPower: boolean,
  head: { readonly closeX: number; readonly controllerHeadX: number },
): boolean {
  if (!wanted) return false;
  return !constantPower || rasterControllerCoordinateMm(head.closeX) !== head.controllerHeadX;
}

// The row's closing move. Under M4 its X word is written even when the head
// already sits there, so the line stays a motion block that darkens the beam
// rather than a bare modal `S0` (under M3 that zero-length close is not
// written at all; see emitSpanSweep).
function formatLaserOffG1(
  x: number,
  feed: number,
  emitFeed: boolean,
  modalFeedrate: boolean,
  writer: ModalMotionWriter,
  style: MotionWordStyle,
): string {
  const motionWord = writer.motion('G1');
  const axisWord = writer.axis('X', x);
  return joinMotionWords(
    [
      motionWord,
      axisWord === '' ? `X${formatMotionCoordinateMm(x, style)}` : axisWord,
      emitFeed || !modalFeedrate ? `F${formatGcodeFeedMmPerMin(feed)}` : '',
      'S0',
    ],
    style,
  );
}

type RasterRunFormatting = {
  readonly input: EmitRasterInput;
  readonly feed: number;
  readonly writer: ModalMotionWriter;
  readonly style: MotionWordStyle;
};

// One G1 closing a run. Emits S only when it changed from the
// previous run (G-code is modal). Emits F only on the very first
// G1 of the whole raster — subsequent G1s inherit the feed.
function formatRunG1(
  x: number,
  s: number,
  prevS: number,
  isVeryFirstG1: boolean,
  formatting: RasterRunFormatting,
): string {
  const { input, feed, writer, style } = formatting;
  return joinMotionWords(
    [
      writer.motion('G1'),
      writer.axis('X', x),
      isVeryFirstG1 || input.modalFeedrate === false ? `F${formatGcodeFeedMmPerMin(feed)}` : '',
      s !== prevS || input.emitSOnEveryBurnMove === true ? `S${s}` : '',
    ],
    style,
  );
}
