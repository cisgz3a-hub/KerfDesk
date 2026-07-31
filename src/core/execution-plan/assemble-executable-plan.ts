import type { GcodeRenderModel, ProgramEvent } from '../gcode-view';
import {
  EXECUTABLE_PLAN_SCHEMA,
  EXECUTABLE_PLAN_SCHEMA_VERSION,
  type BuildExecutablePlanOptions,
  type ExecutablePlanBounds,
  type ExecutablePlanMotion,
  type ExecutablePlanMotionIntent,
  type ExecutablePlanTerminalState,
  type ExecutablePlanTotals,
  type ExecutablePlanV1,
} from './executable-plan-types';

type AssembleExecutablePlanInput = {
  readonly gcode: string;
  readonly model: GcodeRenderModel;
  readonly options: BuildExecutablePlanOptions;
  readonly motions: ReadonlyArray<ExecutablePlanMotion>;
  readonly sendableLineCount: number;
};

/** Assembles the validated semantic components into an immutable v1 plan. */
export function assembleExecutablePlan(input: AssembleExecutablePlanInput): ExecutablePlanV1 {
  const { gcode, model, options, sendableLineCount } = input;
  const motions = classifyPlanParks(input.motions, model.events);
  return {
    schema: EXECUTABLE_PLAN_SCHEMA,
    schemaVersion: EXECUTABLE_PLAN_SCHEMA_VERSION,
    machineKind: options.machineKind,
    controller: {
      emitter: options.controller,
      profileControllerKind: options.profileControllerKind ?? null,
    },
    coordinateSystem: {
      units: 'mm',
      distanceMode: 'absolute',
      initialPositionMm: { x: 0, y: 0, z: 0 },
      initialPositionBasis: 'assumed-work-origin-v1',
    },
    source: {
      rawLineCount: model.lineCount,
      sendableLineCount,
      utf8ByteLength: utf8ByteLength(gcode),
      lineEnding: detectLineEnding(gcode),
    },
    motions,
    events: model.events,
    bounds: {
      allMotionMm: motionBounds(motions),
      processMm: motionBounds(motions, (motion) => motion.intent === 'process'),
    },
    totals: motionTotals(motions),
    terminal: terminalState(motions, model.events),
    diagnostics: { unsupportedWords: model.unsupportedWords },
    compatibility: { serializer: 'legacy-gcode-v1', exactProgram: gcode },
  };
}

function classifyPlanParks(
  motions: ReadonlyArray<ExecutablePlanMotion>,
  events: ReadonlyArray<ProgramEvent>,
): ReadonlyArray<ExecutablePlanMotion> {
  const lastProcess = lastMotionIndex(motions, (motion) => motion.intent === 'process');
  if (lastProcess < 0) return motions;
  const parkIndexes = new Set<number>();
  motions.forEach((motion, index) => {
    if (motion.intent === 'park') parkIndexes.add(index);
  });
  const hasTerminalPark = motions.some(
    (motion, index) => index > lastProcess && motion.intent === 'park',
  );
  if (!hasTerminalPark) {
    const finalTravel = lastMotionIndex(
      motions,
      (motion, index) => index > lastProcess && motion.intent === 'travel',
    );
    if (finalTravel >= 0) parkIndexes.add(finalTravel);
  }
  for (const index of pauseParkIndexes(motions, events)) parkIndexes.add(index);
  return motions.map((motion, index) =>
    parkIndexes.has(index) && motion.intent === 'travel' ? { ...motion, intent: 'park' } : motion,
  );
}

function lastMotionIndex(
  motions: ReadonlyArray<ExecutablePlanMotion>,
  matches: (motion: ExecutablePlanMotion, index: number) => boolean,
): number {
  for (let index = motions.length - 1; index >= 0; index -= 1) {
    const motion = motions[index];
    if (motion !== undefined && matches(motion, index)) return index;
  }
  return -1;
}

function pauseParkIndexes(
  motions: ReadonlyArray<ExecutablePlanMotion>,
  events: ReadonlyArray<ProgramEvent>,
): ReadonlySet<number> {
  const result = new Set<number>();
  let motionIndex = 0;
  let lastTravel = -1;
  for (const event of events) {
    if (event.kind !== 'pause') continue;
    while ((motions[motionIndex]?.rawLineIndex ?? Number.POSITIVE_INFINITY) < event.line) {
      if (motions[motionIndex]?.intent === 'travel') lastTravel = motionIndex;
      motionIndex += 1;
    }
    if (lastTravel >= 0) result.add(lastTravel);
  }
  return result;
}

function motionBounds(
  motions: ReadonlyArray<ExecutablePlanMotion>,
  include: (motion: ExecutablePlanMotion) => boolean = () => true,
): ExecutablePlanBounds | null {
  let bounds: ExecutablePlanBounds | null = null;
  for (const motion of motions) {
    if (!include(motion)) continue;
    for (const point of motion.pointsMm) bounds = extendBounds(bounds, point);
  }
  return bounds;
}

function extendBounds(
  bounds: ExecutablePlanBounds | null,
  point: { readonly x: number; readonly y: number; readonly z: number },
): ExecutablePlanBounds {
  if (bounds === null) {
    return {
      minX: point.x,
      maxX: point.x,
      minY: point.y,
      maxY: point.y,
      minZ: point.z,
      maxZ: point.z,
    };
  }
  return {
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z),
  };
}

function motionTotals(motions: ReadonlyArray<ExecutablePlanMotion>): ExecutablePlanTotals {
  const totals: Record<ExecutablePlanMotionIntent, number> = {
    travel: 0,
    process: 0,
    plunge: 0,
    retract: 0,
    park: 0,
  };
  for (const motion of motions) totals[motion.intent] += motion.lengthMm;
  return {
    routeMm: motions.at(-1)?.routeEndMm ?? 0,
    travelMm: totals.travel,
    processMm: totals.process,
    plungeMm: totals.plunge,
    retractMm: totals.retract,
    parkMm: totals.park,
  };
}

function terminalState(
  motions: ReadonlyArray<ExecutablePlanMotion>,
  events: ReadonlyArray<ProgramEvent>,
): ExecutablePlanTerminalState {
  let spindleMode: ExecutablePlanTerminalState['spindleMode'] = 'off';
  let coolant = { mist: false, flood: false };
  let programEnded = false;
  for (const event of events) {
    spindleMode = spindleModeAfter(spindleMode, event);
    coolant = coolantAfter(coolant, event);
    if (event.kind === 'program-end') programEnded = true;
  }
  return {
    positionMm: motions.at(-1)?.pointsMm.at(-1) ?? null,
    spindleMode,
    coolant: coolantName(coolant),
    programEnded,
  };
}

function spindleModeAfter(
  current: ExecutablePlanTerminalState['spindleMode'],
  event: ProgramEvent,
): ExecutablePlanTerminalState['spindleMode'] {
  if (event.kind === 'spindle-on') return event.mode;
  if (event.kind === 'spindle-off') return 'off';
  return current;
}

function coolantAfter(
  current: { readonly mist: boolean; readonly flood: boolean },
  event: ProgramEvent,
): { readonly mist: boolean; readonly flood: boolean } {
  if (event.kind === 'coolant-off') return { mist: false, flood: false };
  if (event.kind !== 'coolant-on') return current;
  return event.channel === 'mist' ? { ...current, mist: true } : { ...current, flood: true };
}

function coolantName(state: {
  readonly mist: boolean;
  readonly flood: boolean;
}): ExecutablePlanTerminalState['coolant'] {
  if (state.mist && state.flood) return 'mist-and-flood';
  if (state.mist) return 'mist';
  return state.flood ? 'flood' : 'off';
}

function detectLineEnding(text: string): ExecutablePlanV1['source']['lineEnding'] {
  let sawLf = false;
  let sawCr = false;
  let sawCrLf = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\r') {
      if (text[index + 1] === '\n') {
        sawCrLf = true;
        index += 1;
      } else sawCr = true;
    } else if (text[index] === '\n') sawLf = true;
  }
  const count = Number(sawLf) + Number(sawCr) + Number(sawCrLf);
  if (count === 0) return 'none';
  if (count > 1) return 'mixed';
  return sawCrLf ? 'crlf' : sawCr ? 'cr' : 'lf';
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const next = text.charCodeAt(index + 1);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
