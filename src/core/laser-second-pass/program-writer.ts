import { partitionBrushPower } from './brush-partition';
import type { BrushIndex } from './brush-index';
import type { SourceSegment } from './source';
import { DARKENING_EXCURSION_MM } from '../output/grbl-output-cursor';
import type {
  LaserSecondPassBounds,
  LaserSecondPassPoint,
  LaserSecondPassSelection,
} from './types';

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type ProgramWriter = {
  readonly lines: string[];
  readonly bounds: MutableBounds;
  readonly motionBounds: MutableBounds;
  readonly selection: LaserSecondPassSelection;
  readonly index: BrushIndex;
  /** Writer 2 leaves out G1 and S words that repeat the modal value. */
  readonly compact: boolean;
  /** Writer 3 only; legacy writers must keep their sealed bytes unchanged. */
  readonly safeTransitions: boolean;
  position: LaserSecondPassPoint | null;
  previousPosition: LaserSecondPassPoint | null;
  group: number;
  context: number;
  feed: number;
  air: number;
  /** Beam mode currently armed in the output; null until the first sweep. */
  mode: 3 | 4 | null;
  /** Modal motion and power in the output, tracked for compact words. */
  motion: 'G0' | 'G1' | null;
  power: number | null;
  burnLengthMm: number;
  clamped: boolean;
};

function emptyBounds(): MutableBounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function include(bounds: MutableBounds, point: LaserSecondPassPoint): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

/** JS round-trip decimals, expanded because GRBL words do not accept exponents. */
export function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Output contains a non-finite numeric value.');
  const text = String(value);
  const e = text.indexOf('e');
  if (e === -1) return text;
  const negative = text.startsWith('-');
  const mantissa = text.slice(negative ? 1 : 0, e);
  const dot = mantissa.indexOf('.');
  const digits = mantissa.replace('.', '');
  const position = (dot === -1 ? digits.length : dot) + Number(text.slice(e + 1));
  let expanded: string;
  if (position <= 0) expanded = `0.${'0'.repeat(-position)}${digits}`;
  else if (position >= digits.length) expanded = `${digits}${'0'.repeat(position - digits.length)}`;
  else expanded = `${digits.slice(0, position)}.${digits.slice(position)}`;
  return negative ? `-${expanded}` : expanded;
}

export function selectedPower(power: number, scale: number, maximum: number): number {
  // The comparison also handles a finite multiplier whose product would overflow.
  return scale > 0 && power > maximum / scale ? maximum : power * scale;
}

export function createProgramWriter(
  selection: LaserSecondPassSelection,
  index: BrushIndex,
  compact = false,
  safeTransitions = false,
): ProgramWriter {
  return {
    lines: ['; KerfDesk selective second pass', 'G21', 'G90', 'G54', 'G94', 'G17', 'M5'],
    bounds: emptyBounds(),
    motionBounds: emptyBounds(),
    selection,
    index,
    compact,
    safeTransitions,
    position: null,
    previousPosition: null,
    group: -1,
    context: -1,
    feed: 0,
    air: 0,
    mode: null,
    motion: null,
    power: null,
    burnLengthMm: 0,
    clamped: false,
  };
}

function samePoint(a: LaserSecondPassPoint | null, b: LaserSecondPassPoint): boolean {
  return a !== null && a.x === b.x && a.y === b.y;
}

function setAir(writer: ProgramWriter, air: number): void {
  if ((writer.air & air) !== writer.air) {
    writer.lines.push('M9');
    writer.air = 0;
  }
  if ((air & 1) !== 0 && (writer.air & 1) === 0) writer.lines.push('M7');
  if ((air & 2) !== 0 && (writer.air & 2) === 0) writer.lines.push('M8');
  writer.air = air;
}

/** GRBL-family firmware drains the planner on every M3/M4/M5 state change, even
 * in laser mode. Every positioning move already carries S0, which keeps the beam
 * dark in both modes, so the mode word is written only when the mode changes. */
function armBeamMode(writer: ProgramWriter, mode: 3 | 4, forceSync = false): void {
  if (writer.mode === mode && !forceSync) return;
  if (writer.mode !== null) writer.lines.push('M5');
  writer.lines.push(`M${mode} S0`);
  writer.mode = mode;
  writer.power = 0;
}

/** Positions dark at `start` (the sweep's first point, or writer 2's trimmed
 * start) with the source's own entry style, then arms the sweep's beam mode. */
function beginGroup(
  writer: ProgramWriter,
  segment: SourceSegment,
  start: LaserSecondPassPoint = segment.from,
): void {
  if (writer.safeTransitions) {
    beginSafeGroup(writer, segment, start);
    return;
  }
  setAir(writer, segment.air);
  if (!samePoint(writer.position, start)) {
    const coordinates = `X${decimal(start.x)}Y${decimal(start.y)}`;
    if (segment.entry.rapid || segment.entry.feed <= 0) {
      writer.lines.push(`G0${coordinates}S0`);
      writer.motion = 'G0';
    } else {
      writer.lines.push(`G1${coordinates}F${decimal(segment.entry.feed)}S0`);
      writer.motion = 'G1';
    }
    writer.power = 0;
  }
  armBeamMode(writer, segment.mode);
  writer.group = segment.group;
  writer.position = start;
  writer.feed = 0;
  include(writer.motionBounds, start);
}

/** Writer 3 follows the ordinary emitter's dark-before-sync contract. A
 * coincident target is not a dark movement: M3 can drain with the old power
 * still active. Move along the next source edge and back when necessary,
 * retaining the source envelope and travel style. */
function beginSafeGroup(
  writer: ProgramWriter,
  segment: SourceSegment,
  start: LaserSecondPassPoint,
): void {
  const contextChanged = writer.context !== -1 && writer.context !== segment.context;
  const stateChanged = writer.air !== segment.air || writer.mode !== segment.mode;
  positionBeforeTransition(writer, segment, start, stateChanged || contextChanged);
  setAir(writer, segment.air);
  // Air or mode changes already synchronise. A source stop whose final
  // state is unchanged (M5 then M3, or standalone S0) still needs a stop.
  armBeamMode(writer, segment.mode, contextChanged && !stateChanged);
  if (!samePoint(writer.position, start)) writeDarkPosition(writer, segment, start);
  writer.group = segment.group;
  writer.context = segment.context;
  writer.position = start;
  writer.feed = 0;
  include(writer.motionBounds, start);
}

function positionBeforeTransition(
  writer: ProgramWriter,
  segment: SourceSegment,
  start: LaserSecondPassPoint,
  changesState: boolean,
): void {
  const lit = writer.mode === 3 && (writer.power ?? 0) > 0;
  // Prefer the ordinary emitter's up-to-1 mm source-edge excursion over a
  // shorter approach. Actual motor-step resolution remains controller
  // dependent; no finite software displacement proves physical movement.
  const shortApproach =
    writer.position !== null &&
    Math.hypot(start.x - writer.position.x, start.y - writer.position.y) < DARKENING_EXCURSION_MM;
  const excursion = lit && changesState && shortApproach;
  if (excursion) {
    const aside = boundedDarkPoint(start, segment.to);
    // A short edge can end exactly where the preceding cut stopped. Its
    // start is then the distinct point; writing its end would drain lit.
    writeDarkPosition(writer, segment, samePoint(writer.position, aside) ? start : aside);
  } else if (!samePoint(writer.position, start)) {
    writeDarkPosition(writer, segment, start);
  }
}

function boundedDarkPoint(
  start: LaserSecondPassPoint,
  target: LaserSecondPassPoint,
): LaserSecondPassPoint {
  const length = Math.hypot(target.x - start.x, target.y - start.y);
  const scale = Math.min(1, DARKENING_EXCURSION_MM / length);
  const point = {
    x: start.x + (target.x - start.x) * scale,
    y: start.y + (target.y - start.y) * scale,
  };
  // At large finite coordinates a 1 mm interpolation can round back to
  // start. The already-distinct source endpoint is the bounded fallback.
  return samePoint(start, point) ? target : point;
}

/** Writer 3 retains rapid geometry inside a selected continuous-motion
 * context too: a G0 word is not evidence that the controller stopped. */
export function writeSourceRapid(writer: ProgramWriter, segment: SourceSegment): void {
  if (segment.group !== writer.group || segment.context !== writer.context)
    beginGroup(writer, segment);
  writer.lines.push(`G0X${decimal(segment.to.x)}Y${decimal(segment.to.y)}S0`);
  writer.motion = 'G0';
  writer.power = 0;
  writer.position = segment.to;
  include(writer.motionBounds, segment.to);
}

function writeDarkPosition(
  writer: ProgramWriter,
  segment: SourceSegment,
  point: LaserSecondPassPoint,
): void {
  const coordinates = `X${decimal(point.x)}Y${decimal(point.y)}`;
  if (segment.contextEntry.rapid || segment.contextEntry.feed <= 0) {
    writer.lines.push(`G0${coordinates}S0`);
    writer.motion = 'G0';
  } else {
    writer.lines.push(`G1${coordinates}F${decimal(segment.contextEntry.feed)}S0`);
    writer.motion = 'G1';
  }
  writer.power = 0;
  writer.position = point;
  include(writer.motionBounds, point);
}

function pointAt(segment: SourceSegment, parameter: number): LaserSecondPassPoint {
  if (parameter === 0) return segment.from;
  if (parameter === 1) return segment.to;
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * parameter,
    y: segment.from.y + (segment.to.y - segment.from.y) * parameter,
  };
}

function emitMovement(
  writer: ProgramWriter,
  to: LaserSecondPassPoint,
  feed: number,
  power: number,
): void {
  const from = writer.position;
  if (from === null || samePoint(from, to)) return;
  const x = from.x === to.x ? '' : `X${decimal(to.x)}`;
  const y = from.y === to.y ? '' : `Y${decimal(to.y)}`;
  const f = writer.feed === feed ? '' : `F${decimal(feed)}`;
  if (writer.compact) {
    const g = writer.motion === 'G1' ? '' : 'G1';
    const s = writer.power === power ? '' : `S${decimal(power)}`;
    writer.lines.push(`${g}${x}${y}${f}${s}`);
  } else {
    writer.lines.push(`G1${x}${y}${f}S${decimal(power)}`);
  }
  writer.motion = 'G1';
  writer.power = power;
  include(writer.motionBounds, to);
  if (power > 0) {
    include(writer.bounds, from);
    include(writer.bounds, to);
    writer.burnLengthMm += Math.hypot(to.x - from.x, to.y - from.y);
    if (!Number.isFinite(writer.burnLengthMm))
      throw new Error('Selected motion is too large to represent.');
  }
  writer.position = to;
  writer.previousPosition = from;
  writer.feed = feed;
}

export function writeSourceSegment(writer: ProgramWriter, segment: SourceSegment): void {
  if (segment.group !== writer.group) beginGroup(writer, segment);
  const intervals = partitionBrushPower(segment, writer.index, writer.selection.strokes);
  for (const interval of intervals) {
    const power = selectedPower(segment.power, interval.scale, writer.selection.maxPowerS);
    if (interval.scale > 0 && segment.power > writer.selection.maxPowerS / interval.scale) {
      writer.clamped = true;
    }
    emitMovement(writer, pointAt(segment, interval.end), segment.feed, power);
  }
}

/** Writer 2: the part of a source segment between parameters t0 < t1, with
 * consecutive equal-power brush intervals written as one collinear move. */
export function writeClippedSegment(
  writer: ProgramWriter,
  segment: SourceSegment,
  t0: number,
  t1: number,
): void {
  if (
    segment.group !== writer.group ||
    (writer.safeTransitions && segment.context !== writer.context)
  ) {
    beginGroup(writer, segment, pointAt(segment, t0));
  }
  const intervals = partitionBrushPower(segment, writer.index, writer.selection.strokes);
  let pendingEnd = -1;
  let pendingPower = 0;
  for (const interval of intervals) {
    if (interval.end <= t0 || interval.start >= t1) continue;
    const power = selectedPower(segment.power, interval.scale, writer.selection.maxPowerS);
    if (interval.scale > 0 && segment.power > writer.selection.maxPowerS / interval.scale) {
      writer.clamped = true;
    }
    if (pendingEnd >= 0 && pendingPower !== power) {
      emitMovement(writer, pointAt(segment, pendingEnd), segment.feed, pendingPower);
    }
    pendingEnd = Math.min(interval.end, t1);
    pendingPower = power;
  }
  if (pendingEnd >= 0)
    emitMovement(writer, pointAt(segment, pendingEnd), segment.feed, pendingPower);
}

export function finishProgram(writer: ProgramWriter): {
  gcode: string;
  bounds: LaserSecondPassBounds;
  motionBounds: LaserSecondPassBounds;
  burnLengthMm: number;
  clamped: boolean;
} {
  if (writer.burnLengthMm <= 0)
    throw new Error('Paint an area that crosses an engraved part of this job.');
  if (writer.safeTransitions) darkenFinalM3(writer);
  writer.lines.push('M5');
  if (writer.air !== 0) writer.lines.push('M9');
  return {
    gcode: `${writer.lines.join('\n')}\n`,
    bounds: writer.bounds,
    motionBounds: writer.motionBounds,
    burnLengthMm: writer.burnLengthMm,
    clamped: writer.clamped,
  };
}

/** There may be no source dark departure after a selected final M3 cut.
 * Darken along its last emitted edge and return before the final drain,
 * keeping both its endpoint and its exact motion envelope. */
function darkenFinalM3(writer: ProgramWriter): void {
  const end = writer.position;
  const from = writer.previousPosition;
  if (writer.mode !== 3 || (writer.power ?? 0) <= 0 || end === null || from === null) return;
  const aside = boundedDarkPoint(end, from);
  emitMovement(writer, aside, writer.feed, 0);
  emitMovement(writer, end, writer.feed, 0);
}
