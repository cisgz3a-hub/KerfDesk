import { iterateLines } from '../util';
import { readSourceBlock, type SourceBlock } from './source-block';
import type {
  LaserSecondPassPoint,
  LaserSecondPassSegment,
  LaserSecondPassSourceResult,
} from './types';

export type SourceTravelStyle = { readonly rapid: boolean; readonly feed: number };
export type SourceSegment = LaserSecondPassSegment & {
  readonly group: number;
  readonly air: number;
  readonly entry: SourceTravelStyle;
};
type SourceState = {
  x: number | undefined;
  y: number | undefined;
  unit: number;
  absolute: boolean;
  rapid: boolean;
  mode: 3 | 4;
  enabled: boolean;
  power: number;
  feed: number;
  air: number;
  ended: boolean;
  breakGroup: boolean;
  group: number;
  entry: SourceTravelStyle;
  lastTravel: SourceTravelStyle;
};

function initialState(initial: LaserSecondPassPoint | undefined): SourceState {
  if (initial !== undefined && (!Number.isFinite(initial.x) || !Number.isFinite(initial.y))) {
    throw new Error('The original starting position must have finite X and Y coordinates.');
  }
  return {
    x: initial?.x,
    y: initial?.y,
    unit: 1,
    absolute: true,
    rapid: true,
    mode: 4,
    enabled: false,
    power: 0,
    feed: 0,
    air: 0,
    ended: false,
    breakGroup: true,
    group: 0,
    entry: { rapid: true, feed: 0 },
    lastTravel: { rapid: true, feed: 0 },
  };
}

function applyGWords(state: SourceState, codes: ReadonlyArray<number>): void {
  for (const code of codes) {
    if (code === 0) {
      state.rapid = true;
      state.breakGroup = true;
    } else if (code === 1) state.rapid = false;
    else if (code === 20) state.unit = 25.4;
    else if (code === 21) state.unit = 1;
    else if (code === 90) state.absolute = true;
    else if (code === 91) state.absolute = false;
  }
}

function applyMWords(state: SourceState, codes: ReadonlyArray<number>): void {
  for (const code of codes) {
    state.breakGroup = true;
    if (code === 3 || code === 4) {
      state.mode = code;
      state.enabled = true;
    } else if (code === 5) state.enabled = false;
    else if (code === 7) state.air |= 1;
    else if (code === 8) state.air |= 2;
    else if (code === 9) state.air = 0;
    else state.ended = true;
  }
}

function updateModal(state: SourceState, block: SourceBlock): void {
  applyGWords(state, block.g);
  applyMWords(state, block.m);
  if (block.s !== undefined) state.power = block.s;
  if (block.f !== undefined) {
    const feed = block.f * state.unit;
    if (!Number.isFinite(feed))
      throw new Error('Source feed is outside the supported numeric range.');
    if (feed !== state.feed) state.breakGroup = true;
    state.feed = feed;
  }
}

function axisTarget(
  value: number | undefined,
  current: number | undefined,
  state: SourceState,
): number | undefined {
  if (value === undefined) return current;
  if (!state.absolute && current === undefined) {
    throw new Error('Relative source motion needs the original starting X and Y position.');
  }
  const target = value * state.unit + (state.absolute ? 0 : (current ?? 0));
  if (!Number.isFinite(target))
    throw new Error('Source coordinates exceed the supported numeric range.');
  return target;
}

function knownPoint(x: number | undefined, y: number | undefined): LaserSecondPassPoint | null {
  return x === undefined || y === undefined ? null : { x, y };
}

function motionLength(from: LaserSecondPassPoint, to: LaserSecondPassPoint, power: number): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!Number.isFinite(length))
    throw new Error('Source motion exceeds the supported numeric range.');
  if (length === 0 && power > 0)
    throw new Error('Stationary powered source moves cannot be repainted.');
  return length;
}

function sourceMovement(state: SourceState, block: SourceBlock): SourceSegment | null {
  const from = knownPoint(state.x, state.y);
  state.x = axisTarget(block.x, state.x, state);
  state.y = axisTarget(block.y, state.y, state);
  const power = state.enabled && !state.rapid ? state.power : 0;
  if (!state.rapid && state.feed <= 0)
    throw new Error('A source feed move has no known positive feed.');
  if (state.breakGroup) {
    state.group += 1;
    state.entry = state.lastTravel;
    state.breakGroup = false;
  }
  state.lastTravel = { rapid: state.rapid, feed: state.feed };
  if (state.rapid) state.breakGroup = true;
  const to = knownPoint(state.x, state.y);
  if (from === null || to === null) {
    if (power > 0)
      throw new Error('The first engraving move needs the original starting X and Y position.');
    state.breakGroup = true;
    return null;
  }
  if (motionLength(from, to, power) === 0) return null;
  return {
    from,
    to,
    power,
    feed: state.feed,
    mode: state.mode,
    rapid: state.rapid,
    group: state.group,
    air: state.air,
    entry: state.entry,
  };
}

function processBlock(state: SourceState, block: SourceBlock): SourceSegment | null {
  if (state.ended) throw new Error('Executable source text appears after the program end.');
  updateModal(state, block);
  const hasAxes = block.x !== undefined || block.y !== undefined;
  if (state.ended && hasAxes)
    throw new Error('Motion and program end on one source line are unsupported.');
  if (hasAxes) return sourceMovement(state, block);
  const changesBeam = block.s !== undefined || block.m.includes(3);
  if (changesBeam && state.enabled && state.mode === 3 && state.power > 0) {
    throw new Error('Stationary M3 power changes cannot be reproduced by a painted motion pass.');
  }
  return null;
}

/** Visits exact double-precision linear motion without constructing a full route. */
export function visitLaserSecondPassSource(
  sourceGcode: string,
  initial: LaserSecondPassPoint | undefined,
  visit: (segment: SourceSegment) => void,
): void {
  const state = initialState(initial);
  let lineNumber = 0;
  for (const line of iterateLines(sourceGcode)) {
    lineNumber += 1;
    try {
      const block = readSourceBlock(line);
      if (block === null) continue;
      const segment = processBlock(state, block);
      if (segment !== null) visit(segment);
    } catch (error) {
      throw new Error(`Source line ${lineNumber}: ${errorMessage(error)}`);
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The selective pass could not be constructed.';
}

/** Preview convenience; machining construction uses the streaming visitor above. */
export function parseLaserSecondPassSource(
  sourceGcode: string,
  initialPosition?: LaserSecondPassPoint,
): LaserSecondPassSourceResult {
  try {
    const segments: LaserSecondPassSegment[] = [];
    visitLaserSecondPassSource(sourceGcode, initialPosition, (segment) => segments.push(segment));
    return { kind: 'ready', segments };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}
