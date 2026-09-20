// Job Review advisories for whether the serial stream can keep the planner
// fed (ADR-331). Three limits, all read from the exact prepared program and
// the emitted-timeline estimate:
//
//   1. Buffered motion: the character-counting window holds only so many
//      lines, and each line is only so many milliseconds of motion. When that
//      product is shorter than an ordinary host + USB acknowledgement round
//      trip, the controller's planner drains and the machine stops and
//      restarts mid-burn.
//   2. Serial delivery: `transportSeconds` is the part of ADR-221's emitted
//      baseline that transmission could NOT hide under earlier motion
//      (`core/gcode-time/program-transport-time.ts`). Above the link's rate no
//      window size helps, so this warning stands on that landed model rather
//      than re-deriving a byte rate here.
//   3. A line longer than the resolved window can never be sent. Start refuses
//      it factually; saying so here means the operator learns before Frame
//      rather than after it.
//
// Warnings only. A completed Frame for the exact job remains the sole ordinary
// Start policy gate (ADR-228); none of these can refuse a Start.

import { createStreamer, findOversizedLine } from '../../../core/controllers/grbl';
import type { ControllerKind } from '../../../core/devices';
import type { StartStreamWindow } from '../../state/laser-job-effective-stream-options';

export type StreamThroughputInput = {
  readonly gcode: string;
  /** Planner-estimated commanded motion seconds (cut + travel, no dwell). */
  readonly motionSeconds: number;
  /** Estimated serial delivery that could not overlap motion, in seconds. */
  readonly transportSeconds: number;
  readonly window: StartStreamWindow;
  readonly controllerKind: ControllerKind;
};

/**
 * Windows USB-UART bridges commonly release inbound bytes on a ~16 ms latency
 * timer (FTDI's documented default; CH340-class drivers are widely reported to
 * behave similarly, unverified here) and the renderer adds its own task
 * scheduling, so a window holding less motion than this drains on ordinary
 * round trips. Not a measured Falcon figure.
 */
export const MIN_BUFFERED_MOTION_MS = 50;
/** Serial delivery above this share of commanded motion reads as wire-bound. */
export const TRANSPORT_SHARE_WARNING = 0.05;
/** Below this, delivery overhead is not worth a warning however it compares. */
export const MIN_TRANSPORT_WARNING_SECONDS = 1;
/** Tiny programs finish inside the planner's own reserve; do not nag. */
const MIN_LINES_FOR_ADVISORY = 200;

export const BUFFERED_MOTION_WARNING_PREFIX = 'Buffered streaming keeps only';
export const TRANSPORT_WARNING_PREFIX = 'Sending this program takes';
export const OVERSIZED_LINE_WARNING_PREFIX = 'G-code line';

export function detectStreamThroughputWarnings(
  input: StreamThroughputInput,
): ReadonlyArray<string> {
  return [
    ...oversizedLineWarning(input),
    ...bufferedMotionWarning(input),
    ...transportWarning(input),
  ];
}

// A line that cannot fit the window can never be streamed, so Start throws for
// it (`assertGcodeFitsController`). Readiness checks the profile's request,
// which on grblHAL may be wider than the window this session proved — without
// this advisory the refusal would first appear after a completed Frame.
function oversizedLineWarning(input: StreamThroughputInput): ReadonlyArray<string> {
  const oversized = findOversizedLine(input.gcode, input.window.bytes);
  if (oversized === null) return [];
  return [
    `${OVERSIZED_LINE_WARNING_PREFIX} ${oversized.lineNumber} is ${oversized.bytes} bytes, longer ` +
      `than the ${oversized.limit}-byte window this controller session allows, so Start cannot ` +
      `send it. ${windowProvenance(input)}`,
  ];
}

function bufferedMotionWarning(input: StreamThroughputInput): ReadonlyArray<string> {
  const program = measureProgram(input.gcode);
  if (program.lines < MIN_LINES_FOR_ADVISORY || !(input.motionSeconds > 0)) return [];
  const msPerLine = (input.motionSeconds * 1000) / program.lines;
  const linesInWindow = linesInFlight(input.window, program.bytes / program.lines);
  const bufferedMotionMs = linesInWindow * msPerLine;
  if (bufferedMotionMs >= MIN_BUFFERED_MOTION_MS) return [];
  const head =
    input.window.streamingMode === 'ping-pong'
      ? `${BUFFERED_MOTION_WARNING_PREFIX} one acknowledged line (~${formatMs(bufferedMotionMs)} ms of motion) in flight.`
      : `${BUFFERED_MOTION_WARNING_PREFIX} ~${linesInWindow} lines (~${formatMs(bufferedMotionMs)} ms of motion) in the controller's ${input.window.bytes}-byte receive window.`;
  return [
    `${head} Host or USB delays longer than that drain the planner, so the machine may stop and ` +
      `restart mid-burn. ${slowerAdvice(input)}`,
  ];
}

// The emitted timeline already schedules every line's delivery against the
// motion ahead of it, so a non-trivial `transportSeconds` IS the wire limit:
// the controller finished moving and waited for bytes.
function transportWarning(input: StreamThroughputInput): ReadonlyArray<string> {
  const transport = input.transportSeconds;
  if (!(transport >= MIN_TRANSPORT_WARNING_SECONDS)) return [];
  if (!(transport > TRANSPORT_SHARE_WARNING * input.motionSeconds)) return [];
  return [
    `${TRANSPORT_WARNING_PREFIX} about ${formatSeconds(transport)} longer than the motion itself: ` +
      'the serial link cannot deliver G-code as fast as the planned speeds consume it, so expect ' +
      'stop-and-go motion no matter how much the controller buffers. Lower the engraving speed or ' +
      'increase the raster line interval.',
  ];
}

function linesInFlight(window: StartStreamWindow, bytesPerLine: number): number {
  if (window.streamingMode === 'ping-pong') return 1;
  return Math.max(1, Math.floor(window.bytes / bytesPerLine));
}

function slowerAdvice(input: StreamThroughputInput): string {
  const slower = 'Lower the engraving speed or increase the raster line interval';
  if (input.window.streamingMode === 'ping-pong') {
    return `${slower}; this controller family acknowledges one line at a time.`;
  }
  return `${slower}. ${windowProvenance(input)}`;
}

/** Why the window is this size, and what would widen it. */
function windowProvenance(input: StreamThroughputInput): string {
  const window = input.window;
  if (window.source === 'stock-fallback') {
    return input.controllerKind === 'grblhal'
      ? `The controller has not reported its receive buffer this session (grblHAL status-report mask $10 buffer-state bit), so the stock ${window.bytes}-byte window is in use; enable that report or reconnect to widen it.`
      : 'Stock GRBL cannot hold more than its 128-byte receive buffer.';
  }
  if (window.provenBytes !== null && window.bytes < window.requestedBytes) {
    return `The controller reported a ${window.provenBytes}-byte usable buffer, below this machine profile's ${window.requestedBytes}-byte request.`;
  }
  if (window.provenBytes !== null) {
    return `The controller reported room for ${window.provenBytes} bytes and the machine profile requests ${window.requestedBytes}; raise the RX window in Machine Setup to use more of it.`;
  }
  return 'Raise the RX window in Machine Setup if the controller has more room.';
}

// Counted through the streamer itself, so "line" and "byte" mean exactly what
// the character-counting window means.
function measureProgram(gcode: string): { readonly lines: number; readonly bytes: number } {
  const queued = createStreamer(gcode).queued;
  let bytes = 0;
  for (const line of queued) bytes += line.length;
  return { lines: queued.length, bytes };
}

function formatMs(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function formatSeconds(value: number): string {
  return value < 60 ? `${Math.round(value)} s` : `${Math.round(value / 60)} min`;
}
