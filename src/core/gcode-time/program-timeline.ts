import { isSendableGcodeLine } from '../controllers/grbl';
import {
  buildGcodeRenderModel,
  LINE_CATEGORY,
  SEG_MOTION,
  type GcodeRenderModel,
  type ProgramEvent,
} from '../gcode-view';
import { buildProgramTime, type ProgramTimeModel } from './program-time';
import type { MotionLimits } from './motion-limits';

export type ProgramPauseBarrier = {
  readonly rawLineIndex: number;
  readonly sendableLineIndex: number;
  readonly optional: boolean;
};

export type ProgramTimeline = {
  readonly totalSeconds: number;
  readonly motionSeconds: number;
  readonly dwellSeconds: number;
  readonly totalRouteMm: number;
  readonly segmentRawLine: Uint32Array;
  readonly routeStartMm: Float64Array;
  readonly routeEndMm: Float64Array;
  readonly plannedMotionStartSeconds: Float64Array;
  readonly plannedMotionEndSeconds: Float64Array;
  readonly segmentDistanceMm: Float32Array;
  readonly segmentTargetVelocityMmPerSec: Float32Array;
  readonly segmentEntryVelocityMmPerSec: Float32Array;
  readonly segmentExitVelocityMmPerSec: Float32Array;
  readonly accelMmPerSec2: number;
  readonly plannedStartSeconds: Float64Array;
  readonly plannedEndSeconds: Float64Array;
  readonly rawLineStartSeconds: Float64Array;
  readonly rawLineEndSeconds: Float64Array;
  readonly rawLineMotionEndSeconds: Float64Array;
  readonly rawLineDwellEndSeconds: Float64Array;
  readonly sendableLineEndSeconds: Float64Array;
  readonly sendableLineMotionEndSeconds: Float64Array;
  readonly sendableLineDwellEndSeconds: Float64Array;
  readonly pauseBarriers: ReadonlyArray<ProgramPauseBarrier>;
};

export type ProgramTimelineResult =
  | { readonly kind: 'ok'; readonly timeline: ProgramTimeline }
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type ProgramTimelineOptions = {
  readonly initialPositionMm?: { readonly x: number; readonly y: number; readonly z: number };
  readonly maxSegments?: number;
};

type LineTiming = Pick<
  ProgramTimeline,
  | 'rawLineStartSeconds'
  | 'rawLineEndSeconds'
  | 'rawLineMotionEndSeconds'
  | 'rawLineDwellEndSeconds'
  | 'sendableLineEndSeconds'
  | 'sendableLineMotionEndSeconds'
  | 'sendableLineDwellEndSeconds'
  | 'pauseBarriers'
>;

/** Builds a strict execution timeline from the exact program sent to the controller. */
export function buildProgramTimeline(
  gcode: string,
  limits: MotionLimits,
  options: ProgramTimelineOptions = {},
): ProgramTimelineResult {
  const parsed = buildGcodeRenderModel(gcode, options);
  if (parsed.kind === 'error') {
    return parsed.segmentLimit === undefined
      ? parsed
      : {
          kind: 'unavailable',
          reason: 'Exact emitted program exceeds the live countdown segment budget.',
        };
  }
  const unavailableReason = timingUnavailableReason(parsed.model);
  if (unavailableReason !== null) return { kind: 'unavailable', reason: unavailableReason };
  const time = buildProgramTime(parsed.model, limits);
  const lineTiming = buildLineTiming(gcode, parsed.model, time);
  const segmentTiming = buildSegmentTiming(parsed.model, time, lineTiming);
  const motionSeconds = last(lineTiming.rawLineMotionEndSeconds);
  const dwellSeconds = last(lineTiming.rawLineDwellEndSeconds);
  return {
    kind: 'ok',
    timeline: {
      totalSeconds: motionSeconds + dwellSeconds,
      motionSeconds,
      dwellSeconds,
      totalRouteMm: parsed.model.totalRouteMm,
      segmentDistanceMm: time.segDistanceMm,
      segmentTargetVelocityMmPerSec: time.segTargetVelocityMmPerSec,
      segmentEntryVelocityMmPerSec: time.segEntryVelocityMmPerSec,
      segmentExitVelocityMmPerSec: time.segExitVelocityMmPerSec,
      accelMmPerSec2: time.accelMmPerSec2,
      ...segmentTiming,
      ...lineTiming,
    },
  };
}

function timingUnavailableReason(model: GcodeRenderModel): string | null {
  const skipped = model.skippedMotions[0];
  if (skipped !== undefined) {
    return `Skipped motion at raw line ${skipped.line + 1}: ${skipped.reason}.`;
  }
  const unsupported = model.unsupportedWords[0];
  if (unsupported !== undefined) {
    return `Unsupported timing syntax ${unsupported.word} at raw line ${unsupported.firstLine + 1}.`;
  }
  if ([...model.lineCategories].includes(LINE_CATEGORY.junk)) {
    return 'Unsupported timing syntax appears on a junk program line.';
  }
  const unknownEvent = model.events.find(isTimingUnknownEvent);
  if (unknownEvent !== undefined) {
    return `Timing-unknown ${unknownEvent.kind} at raw line ${unknownEvent.line + 1}.`;
  }
  const missingFeedSegment = firstMissingFeedSegment(model);
  if (missingFeedSegment !== null) {
    return `Feed rate unavailable for feed motion at raw line ${missingFeedSegment + 1}.`;
  }
  return null;
}

function firstMissingFeedSegment(model: GcodeRenderModel): number | null {
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segMotion[index] === SEG_MOTION.rapid) continue;
    const feed = model.segFeed[index];
    if (feed !== undefined && Number.isFinite(feed) && feed > 0) continue;
    return model.segLine[index] ?? 0;
  }
  return null;
}

function isTimingUnknownEvent(event: ProgramEvent): boolean {
  return event.kind === 'canned-cycle' || event.kind === 'home';
}

function buildLineTiming(
  gcode: string,
  model: GcodeRenderModel,
  time: ProgramTimeModel,
): LineTiming {
  const lineMotion = new Float64Array(model.lineCount);
  const lineDwell = new Float64Array(model.lineCount);
  for (let index = 0; index < model.segmentCount; index += 1) {
    const line = model.segLine[index];
    if (line !== undefined)
      lineMotion[line] = (lineMotion[line] ?? 0) + (time.segSeconds[index] ?? 0);
  }
  for (const event of model.events) {
    if (event.kind === 'dwell')
      lineDwell[event.line] = (lineDwell[event.line] ?? 0) + event.seconds;
  }
  const rawLineStartSeconds = new Float64Array(model.lineCount);
  const rawLineEndSeconds = new Float64Array(model.lineCount);
  const rawLineMotionEndSeconds = new Float64Array(model.lineCount);
  const rawLineDwellEndSeconds = new Float64Array(model.lineCount);
  let motion = 0;
  let dwell = 0;
  for (let line = 0; line < model.lineCount; line += 1) {
    rawLineStartSeconds[line] = motion + dwell;
    motion += lineMotion[line] ?? 0;
    dwell += lineDwell[line] ?? 0;
    rawLineMotionEndSeconds[line] = motion;
    rawLineDwellEndSeconds[line] = dwell;
    rawLineEndSeconds[line] = motion + dwell;
  }
  return {
    rawLineStartSeconds,
    rawLineEndSeconds,
    rawLineMotionEndSeconds,
    rawLineDwellEndSeconds,
    ...sendableTiming(gcode, rawLineEndSeconds, rawLineMotionEndSeconds, rawLineDwellEndSeconds),
    pauseBarriers: pauseBarriers(gcode, model.events),
  };
}

function sendableTiming(
  gcode: string,
  rawTotal: Float64Array,
  rawMotion: Float64Array,
  rawDwell: Float64Array,
): Pick<
  LineTiming,
  'sendableLineEndSeconds' | 'sendableLineMotionEndSeconds' | 'sendableLineDwellEndSeconds'
> {
  const rawLines = gcode.split(/\r\n|\n|\r/);
  const sendableCount = rawLines.filter(isSendableGcodeLine).length;
  const total = new Float64Array(sendableCount);
  const motion = new Float64Array(sendableCount);
  const dwell = new Float64Array(sendableCount);
  let sendableIndex = 0;
  rawLines.forEach((line, rawLineIndex) => {
    if (!isSendableGcodeLine(line)) return;
    total[sendableIndex] = rawTotal[rawLineIndex] ?? 0;
    motion[sendableIndex] = rawMotion[rawLineIndex] ?? 0;
    dwell[sendableIndex] = rawDwell[rawLineIndex] ?? 0;
    sendableIndex += 1;
  });
  return {
    sendableLineEndSeconds: total,
    sendableLineMotionEndSeconds: motion,
    sendableLineDwellEndSeconds: dwell,
  };
}

function pauseBarriers(
  gcode: string,
  events: ReadonlyArray<ProgramEvent>,
): ReadonlyArray<ProgramPauseBarrier> {
  const rawToSendable = new Int32Array(gcode.split(/\r\n|\n|\r/).length);
  rawToSendable.fill(-1);
  let sendableIndex = 0;
  gcode.split(/\r\n|\n|\r/).forEach((line, rawLineIndex) => {
    if (!isSendableGcodeLine(line)) return;
    rawToSendable[rawLineIndex] = sendableIndex;
    sendableIndex += 1;
  });
  return events.flatMap((event) => {
    if (event.kind !== 'pause') return [];
    const mapped = rawToSendable[event.line] ?? -1;
    return mapped < 0
      ? []
      : [{ rawLineIndex: event.line, sendableLineIndex: mapped, optional: event.optional }];
  });
}

function buildSegmentTiming(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
  lines: LineTiming,
): Pick<
  ProgramTimeline,
  | 'segmentRawLine'
  | 'routeStartMm'
  | 'routeEndMm'
  | 'plannedMotionStartSeconds'
  | 'plannedMotionEndSeconds'
  | 'plannedStartSeconds'
  | 'plannedEndSeconds'
> {
  const segmentRawLine = new Uint32Array(model.segLine);
  const routeStartMm = new Float64Array(model.segmentCount);
  const routeEndMm = new Float64Array(model.segmentCount);
  const plannedMotionStartSeconds = new Float64Array(model.segmentCount);
  const plannedMotionEndSeconds = new Float64Array(model.segmentCount);
  const plannedStartSeconds = new Float64Array(model.segmentCount);
  const plannedEndSeconds = new Float64Array(model.segmentCount);
  let motionElapsed = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    const line = model.segLine[index] ?? 0;
    const motionStart = motionElapsed;
    motionElapsed += time.segSeconds[index] ?? 0;
    const motionEnd = motionElapsed;
    const dwellBefore = line === 0 ? 0 : (lines.rawLineDwellEndSeconds[line - 1] ?? 0);
    routeStartMm[index] = index === 0 ? 0 : (model.segRouteEndMm[index - 1] ?? 0);
    routeEndMm[index] = model.segRouteEndMm[index] ?? routeStartMm[index] ?? 0;
    plannedMotionStartSeconds[index] = motionStart;
    plannedMotionEndSeconds[index] = motionEnd;
    plannedStartSeconds[index] = motionStart + dwellBefore;
    plannedEndSeconds[index] = motionEnd + dwellBefore;
  }
  return {
    segmentRawLine,
    routeStartMm,
    routeEndMm,
    plannedMotionStartSeconds,
    plannedMotionEndSeconds,
    plannedStartSeconds,
    plannedEndSeconds,
  };
}

function last(values: Float64Array): number {
  return values.at(-1) ?? 0;
}
