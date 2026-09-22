import { partitionBrushPower } from './brush-partition';
import type { BrushIndex } from './brush-index';
import type { SourceSegment } from './source';
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
  position: LaserSecondPassPoint | null;
  group: number;
  feed: number;
  air: number;
  /** Beam mode currently armed in the output; null until the first sweep. */
  mode: 3 | 4 | null;
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
): ProgramWriter {
  return {
    lines: ['; KerfDesk selective second pass', 'G21', 'G90', 'G54', 'G94', 'G17', 'M5'],
    bounds: emptyBounds(),
    motionBounds: emptyBounds(),
    selection,
    index,
    position: null,
    group: -1,
    feed: 0,
    air: 0,
    mode: null,
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
function armBeamMode(writer: ProgramWriter, mode: 3 | 4): void {
  if (writer.mode === mode) return;
  if (writer.mode !== null) writer.lines.push('M5');
  writer.lines.push(`M${mode} S0`);
  writer.mode = mode;
}

function beginGroup(writer: ProgramWriter, segment: SourceSegment): void {
  setAir(writer, segment.air);
  if (!samePoint(writer.position, segment.from)) {
    const coordinates = `X${decimal(segment.from.x)}Y${decimal(segment.from.y)}`;
    if (segment.entry.rapid || segment.entry.feed <= 0) {
      writer.lines.push(`G0${coordinates}S0`);
    } else {
      writer.lines.push(`G1${coordinates}F${decimal(segment.entry.feed)}S0`);
    }
  }
  armBeamMode(writer, segment.mode);
  writer.group = segment.group;
  writer.position = segment.from;
  writer.feed = 0;
  include(writer.motionBounds, segment.from);
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
  writer.lines.push(`G1${x}${y}${f}S${decimal(power)}`);
  include(writer.motionBounds, to);
  if (power > 0) {
    include(writer.bounds, from);
    include(writer.bounds, to);
    writer.burnLengthMm += Math.hypot(to.x - from.x, to.y - from.y);
    if (!Number.isFinite(writer.burnLengthMm))
      throw new Error('Selected motion is too large to represent.');
  }
  writer.position = to;
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

export function finishProgram(writer: ProgramWriter): {
  gcode: string;
  bounds: LaserSecondPassBounds;
  motionBounds: LaserSecondPassBounds;
  burnLengthMm: number;
  clamped: boolean;
} {
  if (writer.burnLengthMm <= 0)
    throw new Error('Paint an area that crosses an engraved part of this job.');
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
