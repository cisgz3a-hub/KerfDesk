import { iterateLines } from '../util';
import { sourceArcChordEnds } from './source-arc';
import { readSourceBlock, type SourceBlock } from './source-block';
import { detectLaserSourceFamily, unsupportedLaserSourceMessage } from './source-family';
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
type SourceDirection = { readonly dx: number; readonly dy: number };
type SourceState = {
  x: number | undefined;
  y: number | undefined;
  unit: number;
  absolute: boolean;
  rapid: boolean;
  /** G2 or G3 while the modal motion is an arc (ADR-432), else null. */
  arc: 2 | 3 | null;
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
  /** Unit direction of the previous movement with length. */
  lastDirection: SourceDirection | null;
  /** The previous movement was a laser-off feed move leaving the line before it. */
  afterDarkTurn: boolean;
};

/** Sine of the widest angle still read as one straight sweep. Emitted coordinates
 * carry three decimals, so a short runway can differ from the burn it feeds by a
 * few milliradians; a row change or a reversal is orders of magnitude larger. */
const SWEEP_TURN_SINE = 0.05;

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
    arc: null,
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
    lastDirection: null,
    afterDarkTurn: false,
  };
}

function applyGWords(state: SourceState, codes: ReadonlyArray<number>): void {
  for (const code of codes) {
    if (code === 0) {
      state.rapid = true;
      state.arc = null;
      state.breakGroup = true;
    } else if (code === 1) {
      state.rapid = false;
      state.arc = null;
    } else if (code === 2 || code === 3) {
      state.rapid = false;
      state.arc = code;
    } else if (code === 20) state.unit = 25.4;
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

function movementDirection(
  from: LaserSecondPassPoint | null,
  to: LaserSecondPassPoint | null,
  power: number,
): SourceDirection | null {
  if (from === null || to === null) return null;
  const length = motionLength(from, to, power);
  return length === 0 ? null : { dx: (to.x - from.x) / length, dy: (to.y - from.y) / length };
}

function continuesDirection(previous: SourceDirection | null, next: SourceDirection): boolean {
  if (previous === null) return false;
  const dot = previous.dx * next.dx + previous.dy * next.dy;
  const cross = previous.dx * next.dy - previous.dy * next.dx;
  return dot > 0 && Math.abs(cross) <= SWEEP_TURN_SINE;
}

/** Sweeps end at rapids, mode/air words and feed changes, and also where a
 * laser-off feed move leaves the current line: that move repositions the head
 * (a controlled-dark row change) rather than feeding a burn. The move after
 * such a turn starts its own sweep unless it continues the turned line, in
 * which case the turn was a runway and stays with the burn it leads into. */
function beginSweepIfNeeded(
  state: SourceState,
  direction: SourceDirection | null,
  power: number,
): void {
  const turns = direction !== null && !continuesDirection(state.lastDirection, direction);
  const darkTurn = turns && !state.rapid && power === 0;
  if (state.breakGroup || darkTurn || (state.afterDarkTurn && turns)) {
    state.group += 1;
    // No travel precedes the first sweep. When the program's own opening move
    // is a controlled laser-off feed move, position the derived pass the same
    // way instead of introducing a rapid into a program that has none.
    state.entry =
      state.group === 1 && !state.rapid && power === 0
        ? { rapid: false, feed: state.feed }
        : state.lastTravel;
    state.breakGroup = false;
  }
  if (direction !== null) {
    state.lastDirection = direction;
    state.afterDarkTurn = darkTurn;
  }
}

function sourceMovement(state: SourceState, block: SourceBlock): SourceSegment | null {
  const from = knownPoint(state.x, state.y);
  state.x = axisTarget(block.x, state.x, state);
  state.y = axisTarget(block.y, state.y, state);
  return movementTo(state, from);
}

/** One linear movement from `from` to the state's current position. */
function movementTo(state: SourceState, from: LaserSecondPassPoint | null): SourceSegment | null {
  const power = state.enabled && !state.rapid ? state.power : 0;
  if (!state.rapid && state.feed <= 0)
    throw new Error('A source feed move has no known positive feed.');
  const to = knownPoint(state.x, state.y);
  const direction = movementDirection(from, to, power);
  beginSweepIfNeeded(state, direction, power);
  state.lastTravel = { rapid: state.rapid, feed: state.feed };
  if (state.rapid) state.breakGroup = true;
  if (from === null || to === null) {
    if (power > 0)
      throw new Error('The first engraving move needs the original starting X and Y position.');
    state.breakGroup = true;
    return null;
  }
  if (direction === null) return null;
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

/** A G2/G3 source line as the chords GRBL runs for it (source-arc.ts), each
 * visited as one linear movement. */
function arcMovements(
  state: SourceState,
  block: SourceBlock,
  visit: (segment: SourceSegment) => void,
): void {
  const from = knownPoint(state.x, state.y);
  if (from === null)
    throw new Error('Arc source moves need the original starting X and Y position.');
  if (block.i === undefined && block.j === undefined) {
    throw new Error('Arc source moves need I or J centre offsets; R arcs are not supported.');
  }
  const chordEnds = sourceArcChordEnds({
    from,
    target: {
      x: axisTarget(block.x, state.x, state) as number,
      y: axisTarget(block.y, state.y, state) as number,
    },
    center: { x: from.x + (block.i ?? 0) * state.unit, y: from.y + (block.j ?? 0) * state.unit },
    clockwise: state.arc === 2,
  });
  let previous = from;
  for (const point of chordEnds) {
    state.x = point.x;
    state.y = point.y;
    const segment = movementTo(state, previous);
    if (segment !== null) visit(segment);
    previous = point;
  }
}

/** Visits a line's motion; false when it has none. */
function visitMotion(
  state: SourceState,
  block: SourceBlock,
  visit: (segment: SourceSegment) => void,
): boolean {
  const hasAxes = block.x !== undefined || block.y !== undefined;
  const hasOffsets = block.i !== undefined || block.j !== undefined;
  if (state.arc !== null && (hasAxes || hasOffsets)) {
    // GRBL refuses an arc without an axis word in its plane (error 26).
    if (!hasAxes) throw new Error('Arc source moves need an X or Y end point.');
    arcMovements(state, block, visit);
    return true;
  }
  if (hasOffsets) throw new Error('I and J words need G2 or G3 motion.');
  if (!hasAxes) return false;
  const segment = sourceMovement(state, block);
  if (segment !== null) visit(segment);
  return true;
}

function processBlock(
  state: SourceState,
  block: SourceBlock,
  visit: (segment: SourceSegment) => void,
): void {
  if (state.ended) throw new Error('Executable source text appears after the program end.');
  updateModal(state, block);
  const hasAxes = block.x !== undefined || block.y !== undefined;
  if (state.ended && hasAxes)
    throw new Error('Motion and program end on one source line are unsupported.');
  if (visitMotion(state, block, visit)) return;
  const changesBeam = block.s !== undefined || block.m.includes(3);
  if (changesBeam && state.enabled && state.mode === 3 && state.power > 0) {
    throw new Error('Stationary M3 power changes cannot be reproduced by a painted motion pass.');
  }
}

/** Visits exact double-precision linear motion without constructing a full route.
 * G2/G3 arcs arrive as the chords the controller runs for them (ADR-432). */
export function visitLaserSecondPassSource(
  sourceGcode: string,
  initial: LaserSecondPassPoint | undefined,
  visit: (segment: SourceSegment) => void,
): void {
  // Native Marlin and Smoothieware programs would otherwise fail on their first
  // prelude line; name the controller instead of reporting an unreadable word.
  const unsupported = unsupportedLaserSourceMessage(detectLaserSourceFamily(sourceGcode));
  if (unsupported !== null) throw new Error(unsupported);
  const state = initialState(initial);
  let lineNumber = 0;
  for (const line of iterateLines(sourceGcode)) {
    lineNumber += 1;
    try {
      const block = readSourceBlock(line);
      if (block === null) continue;
      processBlock(state, block, visit);
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
