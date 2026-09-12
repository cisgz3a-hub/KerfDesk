import type { Vec2 } from '../../core/scene';
import type { PreparedPreviewFrame, PreviewDisplayStep } from './preview-route-frame';

/** Transfer-owned display data; these buffers never alias the source route or frame. */
export type PackedPreviewFrame = {
  readonly coordinates: Float64Array<ArrayBuffer>;
  readonly commands: Uint32Array<ArrayBuffer>;
};

const VERSION = 1;
const HEADER_WORDS = 4;
const PARTIAL = 1;
const HEAD = 2;
const START = 4;
const END = 8;
const CUT = 0;
const TRAVEL = 1;
const RAPID = 2;
const FEED = 3;
const UNDEFINED_MOTION = 4;

/** The header stores version, future count, whole count and presence bits.
 * Each ordered command then stores opcode and point count. XY doubles follow
 * in command order, followed by the present head, start and end markers. */
export function packPreviewFrame(frame: PreparedPreviewFrame): PackedPreviewFrame {
  const flags = presenceFlags(frame);
  const count = frame.futureSteps.length + frame.wholeSteps.length + (flags & PARTIAL);
  let points = markerCount(flags);
  for (const step of frame.futureSteps) points += pointCount(step);
  for (const step of frame.wholeSteps) points += pointCount(step);
  if (frame.partial !== null) points += pointCount(frame.partial);
  const commands = new Uint32Array(HEADER_WORDS + count * 2);
  const coordinates = new Float64Array(points * 2);
  commands.set([VERSION, frame.futureSteps.length, frame.wholeSteps.length, flags]);
  const writer = new FrameWriter(commands, coordinates);
  for (const step of frame.futureSteps) writer.step(step);
  for (const step of frame.wholeSteps) writer.step(step);
  if (frame.partial !== null) writer.step(frame.partial);
  if (frame.head !== null) writer.point(frame.head);
  if (frame.start !== null) writer.point(frame.start);
  if (frame.end !== null) writer.point(frame.end);
  return { coordinates, commands };
}

/** Validate the complete packet before allocating or publishing display commands. */
export function unpackPreviewFrame(packed: PackedPreviewFrame): PreparedPreviewFrame {
  const { futureCount, wholeCount, flags } = validatePackedFrame(packed);
  const reader = new FrameReader(packed.commands, packed.coordinates);
  return {
    futureSteps: reader.steps(futureCount),
    wholeSteps: reader.steps(wholeCount),
    partial: flags & PARTIAL ? reader.step() : null,
    head: flags & HEAD ? reader.point() : null,
    start: flags & START ? reader.point() : null,
    end: flags & END ? reader.point() : null,
  };
}

export function packedPreviewFrameTransfers(packed: PackedPreviewFrame): ArrayBuffer[] {
  return [packed.coordinates.buffer, packed.commands.buffer];
}

function pointCount(step: PreviewDisplayStep): number {
  return step.kind === 'cut' ? step.polyline.length : 2;
}

function markerCount(flags: number): number {
  return (
    Number(Boolean(flags & HEAD)) + Number(Boolean(flags & START)) + Number(Boolean(flags & END))
  );
}

function presenceFlags(frame: PreparedPreviewFrame): number {
  return (
    (frame.partial === null ? 0 : PARTIAL) |
    (frame.head === null ? 0 : HEAD) |
    (frame.start === null ? 0 : START) |
    (frame.end === null ? 0 : END)
  );
}

function opcode(step: PreviewDisplayStep): number {
  if (step.kind === 'cut') return CUT;
  if (step.motion === 'rapid') return RAPID;
  if (step.motion === 'feed') return FEED;
  if (step.motion === undefined) {
    return Object.hasOwn(step, 'motion') ? UNDEFINED_MOTION : TRAVEL;
  }
  throw new Error('Invalid Preview display motion');
}

class FrameWriter {
  private commandIndex = HEADER_WORDS;
  private coordinateIndex = 0;

  constructor(
    private readonly commands: Uint32Array,
    private readonly coordinates: Float64Array,
  ) {}

  step(step: PreviewDisplayStep): void {
    this.commands[this.commandIndex++] = opcode(step);
    this.commands[this.commandIndex++] = pointCount(step);
    if (step.kind === 'cut') {
      for (const point of step.polyline) this.point(point);
    } else {
      this.point(step.from);
      this.point(step.to);
    }
  }

  point(point: Vec2): void {
    this.coordinates[this.coordinateIndex++] = point.x;
    this.coordinates[this.coordinateIndex++] = point.y;
  }
}

class FrameReader {
  private commandIndex = HEADER_WORDS;
  private coordinateIndex = 0;

  constructor(
    private readonly commands: Uint32Array,
    private readonly coordinates: Float64Array,
  ) {}

  steps(count: number): PreviewDisplayStep[] {
    const steps = new Array<PreviewDisplayStep>(count);
    for (let index = 0; index < count; index++) steps[index] = this.step();
    return steps;
  }

  step(): PreviewDisplayStep {
    const code = this.commands[this.commandIndex++] ?? CUT;
    const count = this.commands[this.commandIndex++] ?? 0;
    if (code === CUT) {
      const polyline = new Array<Vec2>(count);
      for (let index = 0; index < count; index++) polyline[index] = this.point();
      return { kind: 'cut', polyline };
    }
    const from = this.point();
    const to = this.point();
    if (code === RAPID) return { kind: 'travel', from, to, motion: 'rapid' };
    if (code === FEED) return { kind: 'travel', from, to, motion: 'feed' };
    const step: PreviewDisplayStep = { kind: 'travel', from, to };
    // Normally omitted by preparePreviewFrame; retain presence for runtime callers too.
    if (code === UNDEFINED_MOTION) Object.assign(step, { motion: undefined });
    return step;
  }

  point(): Vec2 {
    return {
      x: this.coordinates[this.coordinateIndex++] ?? 0,
      y: this.coordinates[this.coordinateIndex++] ?? 0,
    };
  }
}

function validatePackedFrame(packed: PackedPreviewFrame) {
  const words = packed.commands;
  const futureCount = words[1] ?? 0;
  const wholeCount = words[2] ?? 0;
  const flags = words[3] ?? 0;
  const count = futureCount + wholeCount + (flags & PARTIAL);
  if (
    words[0] !== VERSION ||
    flags > (PARTIAL | HEAD | START | END) ||
    words.length !== HEADER_WORDS + count * 2
  ) {
    throw new Error('Invalid Preview display header');
  }
  const points = markerCount(flags) + validateCommandPoints(words);
  if (packed.coordinates.length !== points * 2) {
    throw new Error('Invalid Preview display coordinates');
  }
  return { futureCount, wholeCount, flags };
}

function validateCommandPoints(words: Uint32Array): number {
  let points = 0;
  for (let index = HEADER_WORDS; index < words.length; index += 2) {
    const code = words[index] ?? CUT;
    const size = words[index + 1] ?? 0;
    if (code > UNDEFINED_MOTION || (code !== CUT && size !== 2)) {
      throw new Error('Invalid Preview display command');
    }
    points += size;
  }
  return points;
}
