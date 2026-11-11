// One planned raster sweep, including its controller-grid and modal state.
import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { formatGcodePowerS } from '../gcode/decimal-word';
import {
  createModalMotionWriter,
  formatMotionCoordinateMm,
  joinMotionWords,
  motionWordStyleFor,
  type ModalMotionWriter,
  type MotionWordStyle,
} from '../gcode/motion-words';
import type { RasterRowSweepPlan } from './raster-sweep-plan';
import {
  rasterEntryExcursion,
  rasterSweepOpening,
  type RasterControllerHead,
} from './emit-raster-travel';
import { sameRasterHead, type RasterRowLine } from './emit-raster-row-line';
import type { EmitRasterInput } from './emit-raster';
import { rasterRowShiftX } from '../job/scan-offset';
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
    rowShiftX: rasterRowShiftX(input.scanOffsetMm ?? 0, reverse, input.bidirectional ?? true),
  };
}

type RasterSweepEmission = {
  readonly lines: ReadonlyArray<string>;
  /** An engraving F word was actually written, rather than only a seek. */
  readonly feedEmitted: boolean;
  /** Under M3, or with `stopKeepsPower`, the last move that moved the head was
   *  a burn, so a stop right after the sweep would be lit. */
  readonly endsLit: boolean;
  readonly head: RasterControllerHead;
};

/** What the group's earlier lines left at a sweep's start. */
export type RasterSweepIncoming = {
  readonly head: RasterControllerHead | null;
  /** The group's opening still waits for its first laser-off travel (OR-1). */
  readonly deferredOpening: boolean;
  /** A stop here would be lit (see RasterSweepEmission.endsLit). */
  readonly lit: boolean;
};

export function emitSpanSweep(
  input: EmitRasterInput,
  line: RasterRowLine,
  pixelWidthMm: number,
  feed: number,
  emitFeed: boolean,
  reverse: boolean,
  sweepPlan: RasterRowSweepPlan,
  dotWidthCorrectionMm: number,
  incoming: RasterSweepIncoming,
): RasterSweepEmission {
  // Under M3 a motion line that does not move the head drains GRBL's planner
  // with the beam still at the last run's power (GRBL motion_control.c:67-76,
  // grblHAL motion_control.c:182-190), so no zero-length move is written there,
  // laser-off or not (2026-09-25 controller audit, OR-1). Under M4 the stop is
  // dark and the historical bytes stay.
  const constantPower = input.laserModeCommand === 'M3';
  // Marlin (`stopKeepsPower`) runs the M4 body as continuous power, which stays
  // lit at a stop, and plans no block for a move that does not move the head
  // (planner.cpp:2247-2248), so that move's S0 is never applied (stepper.cpp
  // :2574-2584). Its bytes stay those of M4; the sweep only reports a lit
  // ending, so the group's closing M5 can wait for a dark move (ADR-398
  // Amendment 2).
  const reportsLitStop = constantPower || input.stopKeepsPower === true;
  const { head: previousHead, deferredOpening } = incoming;
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
  const startHead = line.head(startX + rowShiftX);
  // Rapid into the overscan zone, laser off (M4 + S0 → diode dark).
  const opening = rasterSweepOpening(
    {
      ...line.point(startX + rowShiftX),
      target: startHead,
      previousHead,
      constantPower: constantPower || deferredOpening,
      controlledFeed: input.controlledLaserOffTravelFeedMmPerMin,
    },
    writer,
    style,
  );
  const state: SweepState = {
    lines: [...opening.lines],
    head: startHead,
    headScanX: line.scanX(startX + rowShiftX),
    prevS: opening.prevS,
    // A controlled G1 seek changes F; reassert engraving feed after it.
    feedPending: emitFeed || input.controlledLaserOffTravelFeedMmPerMin !== undefined,
    feedEmitted: false,
    // An opening travel to where the head already is leaves the beam as it was.
    endsOnBurn: incoming.lit && previousHead !== null && sameRasterHead(startHead, previousHead),
  };
  const formatting = { input, feed, writer, style, line, constantPower, deferredOpening };
  const pushRun = (x: number, s: number, comment?: string): void =>
    pushRasterRun(state, x + rowShiftX, s, formatting, comment);
  // The runways are laser-off feed moves the operator asked for, marked as the
  // Fill runways are so preflight excuses them up to the overscan (ADR-415
  // Amendment 1).
  if (sweepPlan.leadInMm > 0) {
    pushRun(reverse ? activeEndX : activeStartX, 0, runwayComment(sweepPlan.leadInMm));
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
    runwayComment(sweepPlan.leadOutMm),
  );
  return {
    lines: state.lines,
    feedEmitted: state.feedEmitted,
    endsLit: reportsLitStop && state.endsOnBurn,
    head: state.head,
  };
}

type SweepState = {
  readonly lines: string[];
  /** Where the controller holds the head, on its grid. */
  head: RasterControllerHead;
  /** The same position along the row, in the scan frame (see RasterRowLine.scanX). */
  headScanX: number;
  prevS: number;
  feedPending: boolean;
  feedEmitted: boolean;
  /** The last line that moved the head was a burn. A line that does not move
   *  it (written under M4 only) leaves this as it was. */
  endsOnBurn: boolean;
};

type SweepFormatting = RasterRunFormatting & {
  readonly constantPower: boolean;
  readonly deferredOpening: boolean;
};

function pushRasterRun(
  state: SweepState,
  x: number,
  s: number,
  formatting: SweepFormatting,
  comment?: string,
): void {
  const { line } = formatting;
  const target = line.head(x);
  const previousM3StillLit = formatting.deferredOpening && state.lines.length === 0;
  if (
    (s > 0 || formatting.constantPower || previousM3StillLit) &&
    sameRasterHead(target, state.head)
  )
    return;
  if (s > 0 && previousM3StillLit) {
    state.lines.push(...rasterEntryExcursion(line, state.headScanX, line.scanX(x), formatting));
    state.prevS = 0;
  }
  state.lines.push(formatRunG1(x, s, state.prevS, state.feedPending, formatting, comment));
  state.feedEmitted ||= state.feedPending || formatting.input.modalFeedrate === false;
  state.feedPending = false;
  state.prevS = s;
  if (!sameRasterHead(target, state.head)) state.endsOnBurn = s > 0;
  state.head = target;
  state.headScanX = line.scanX(x);
}

function closeRasterSweep(
  state: SweepState,
  x: number,
  wanted: boolean,
  formatting: SweepFormatting,
  comment: string | undefined,
): void {
  const { input, feed, line, constantPower, deferredOpening } = formatting;
  const closeHead = line.head(x);
  if (
    !writesRowClose(wanted, constantPower || (deferredOpening && state.lines.length === 0), {
      closeHead,
      controllerHead: state.head,
    })
  )
    return;
  state.lines.push(
    formatLaserOffG1(x, feed, state.feedPending, input.modalFeedrate ?? true, formatting, comment),
  );
  state.feedEmitted ||= state.feedPending || input.modalFeedrate === false;
  if (!sameRasterHead(closeHead, state.head)) state.endsOnBurn = false;
  state.head = closeHead;
  state.headScanX = line.scanX(x);
}

/** The laser-off marker for a run-in or run-out the overscan asked for. */
function runwayComment(runwayMm: number): string | undefined {
  return runwayMm > 0 ? INTENTIONAL_LASER_OFF_MOTION_COMMENT : undefined;
}

function writesRowClose(
  wanted: boolean,
  constantPower: boolean,
  head: { readonly closeHead: RasterControllerHead; readonly controllerHead: RasterControllerHead },
): boolean {
  if (!wanted) return false;
  return !constantPower || !sameRasterHead(head.closeHead, head.controllerHead);
}

// The row's closing move. Under M4 its X word is written even when the head
// already sits there, so the line stays a motion block that darkens the beam
// rather than a bare modal `S0` (under M3 that zero-length close is not
// written at all, and Marlin drops it without darkening; see emitSpanSweep).
function formatLaserOffG1(
  x: number,
  feed: number,
  emitFeed: boolean,
  modalFeedrate: boolean,
  formatting: RasterRunFormatting,
  comment: string | undefined,
): string {
  const { writer, style, line } = formatting;
  const motionWord = writer.motion('G1');
  const axisWords = line.axisWords(writer, x);
  return joinMotionWords(
    [
      motionWord,
      ...(axisWords.every((word) => word === '')
        ? [`X${formatMotionCoordinateMm(line.point(x).x, style)}`]
        : axisWords),
      emitFeed || !modalFeedrate ? `F${formatGcodeFeedMmPerMin(feed)}` : '',
      'S0',
    ],
    style,
    comment,
  );
}

type RasterRunFormatting = {
  readonly input: EmitRasterInput;
  readonly feed: number;
  readonly writer: ModalMotionWriter;
  readonly style: MotionWordStyle;
  readonly line: RasterRowLine;
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
  comment?: string,
): string {
  const { input, feed, writer, style, line } = formatting;
  return joinMotionWords(
    [
      writer.motion('G1'),
      ...line.axisWords(writer, x),
      isVeryFirstG1 || input.modalFeedrate === false ? `F${formatGcodeFeedMmPerMin(feed)}` : '',
      s !== prevS || input.emitSOnEveryBurnMove === true
        ? `S${formatGcodePowerS(s, input.laserPowerScaleVersion)}`
        : '',
    ],
    style,
    comment,
  );
}
