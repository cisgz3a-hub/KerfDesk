// The strict program clock's totals, without its per-line and per-segment
// clocks (performance audit S3-P2-3).
//
// A job ETA reads five numbers from a ProgramTimeline: the total, the motion
// breakdown, dwell, transport and the count of manual pauses. Building the
// whole timeline for them kept about 1.25 GB of typed arrays for a bed-sized
// photo (8 million lines and segments), on top of the parse and the planner,
// and split the program into 8 million strings twice; the background job
// preparation that times every edit then peaked near 4 GB.
//
// Every total here is the same floating-point value the timeline reports: the
// same parse and planner, per-line sums accumulated in segment order, then
// line by line, exactly as buildLineTiming does, and the same transport clock.
//
// The planner runs in columns as the parser reads each move, so neither the
// render model's moves nor a Block per move is kept (ADR-244 Amendment 2).

import { isSendableGcodeLine } from '../controllers/grbl';
import type { GcodeRenderModel } from '../gcode-view';
import { createGcodeRenderModelBuilder } from '../gcode-view/gcode-render-model-builder';
import type { ChunkedColumn } from '../motion-planner/chunked-column';
import { iterateLines } from '../util/iterate-lines';
import type { MotionLimits } from './motion-limits';
import type { ProgramMotionBreakdown } from './program-time';
import {
  checkTimedParse,
  timedParseOptions,
  type ProgramTimelineOptions,
  type ProgramTimelineResult,
} from './program-timeline';
import { createTransportClock, forEachRawLine } from './program-transport-time';
import { StreamedMotion } from './streamed-motion';

export type ProgramDuration = {
  readonly totalSeconds: number;
  readonly motionSeconds: number;
  readonly dwellSeconds: number;
  readonly transportSeconds: number;
  readonly breakdown: ProgramMotionBreakdown;
  /** The timeline's pauseBarriers.length: M0/M1 events on sendable lines. */
  readonly pauseCount: number;
};

export type ProgramDurationResult =
  | { readonly kind: 'ok'; readonly duration: ProgramDuration }
  | Exclude<ProgramTimelineResult, { readonly kind: 'ok' }>;

/** buildProgramTimeline's totals, keeping only two line-length arrays. */
export function buildProgramDuration(
  gcode: string,
  limits: MotionLimits,
  options: ProgramTimelineOptions = {},
): ProgramDurationResult {
  const { timingOptions, renderOptions } = timedParseOptions(options);
  const stream = new StreamedMotion(limits, timingOptions);
  const builder = createGcodeRenderModelBuilder(renderOptions, stream.segments, stream.events);
  // The lines buildGcodeRenderModel reads.
  for (const line of iterateLines(gcode)) {
    builder.pushLine(line);
    stream.endLine();
  }
  const parsed = checkTimedParse(builder.finish(), timingOptions, stream.missingFeedLine());
  if (parsed.kind !== 'ok') return parsed;
  const { model } = parsed;
  const motion = stream.finish();
  // Seconds of motion per raw line, as perLineDurations sums them.
  const lineSeconds = stream.lineSeconds;
  const lineDwell = dwellByLine(model);
  // Running motion and dwell, line by line, as buildLineTiming accumulates
  // them. lineSeconds is overwritten in place with each line's start time,
  // which is all the transport clock needs from it.
  let motionSeconds = 0;
  let dwellSeconds = 0;
  for (let line = 0; line < model.lineCount; line += 1) {
    const ownMotion = lineSeconds.get(line);
    lineSeconds.set(line, motionSeconds + dwellSeconds);
    motionSeconds += ownMotion;
    dwellSeconds += lineDwell[line] ?? 0;
  }
  const lines = walkRawLines(gcode, model, lineSeconds, timingOptions);
  return {
    kind: 'ok',
    duration: {
      totalSeconds: motionSeconds + dwellSeconds + lines.transportSeconds,
      motionSeconds,
      dwellSeconds,
      transportSeconds: lines.transportSeconds,
      breakdown: motion.breakdown,
      pauseCount: lines.pauseCount,
    },
  };
}

function dwellByLine(model: GcodeRenderModel): Float64Array {
  const lineDwell = new Float64Array(model.lineCount);
  for (const event of model.events) {
    if (event.kind === 'dwell')
      lineDwell[event.line] = (lineDwell[event.line] ?? 0) + event.seconds;
  }
  return lineDwell;
}

// One pass over the raw lines for the two totals that read their text: the
// transport delay as of the last parsed line (the timeline's last element) and
// how many pause events sit on a sendable line.
function walkRawLines(
  gcode: string,
  model: GcodeRenderModel,
  rawLineStartSeconds: ChunkedColumn<Float64Array>,
  options: ProgramTimelineOptions,
): { readonly transportSeconds: number; readonly pauseCount: number } {
  const clock = createTransportClock(options.baudRate, options.hostToolChangePauses);
  const pausesByLine = new Map<number, number>();
  for (const event of model.events) {
    if (event.kind === 'pause')
      pausesByLine.set(event.line, (pausesByLine.get(event.line) ?? 0) + 1);
  }
  if (clock === null && pausesByLine.size === 0) return { transportSeconds: 0, pauseCount: 0 };
  const lastLine = model.lineCount - 1;
  let transportSeconds = 0;
  let pauseCount = 0;
  forEachRawLine(gcode, (rawLine, index) => {
    const pauses = pausesByLine.get(index);
    if (pauses !== undefined && isSendableGcodeLine(rawLine)) pauseCount += pauses;
    if (clock === null) return;
    const transport = clock.line(rawLine, rawLineStartSeconds.get(index));
    if (index === lastLine) transportSeconds = transport;
  });
  return { transportSeconds, pauseCount };
}
