import type { MotionBlock, MotionBlockKind, MotionPoint } from './motion-manifest';

/**
 * The blocks of a motion manifest stored as columns (ADR-244 Amendment 3).
 *
 * One object per block and per point cost about 290 bytes per streamed line:
 * 2.3 GB for one bed-sized photo (8 M lines), held once in the preparation
 * worker and again in the window after unpacking. These columns hold the same
 * blocks in about 37 bytes per line and cross the worker boundary by transfer.
 *
 * Every number keeps its original IEEE-754 double. Nothing is simplified:
 * - a block whose first point equals the previous block's last point (by
 *   Object.is on x, y and z) stores it once, flagged in its kind byte;
 * - Z is a column only once some point's Z differs from the first one's;
 * - a block's length is not stored: `lengthMm` is the same `polylineLength`
 *   of the same doubles the parser measured, and its route start is the
 *   previous block's route end, exactly as the parser carried it.
 */
export const MOTION_BLOCK_COLUMNS_ENCODING = 'motion-block-columns-v1';

export const MOTION_BLOCK_KINDS: ReadonlyArray<MotionBlockKind> = [
  'travel',
  'process',
  'plunge',
  'park',
];
/** Kind-byte flag: the block's first point is the previous block's last. */
export const SHARED_START = 0x80;
export const KIND_MASK = 0x7f;

/** Plain, transferable data: survives structured clone and IndexedDB. */
export type MotionBlockColumnData = {
  readonly encoding: typeof MOTION_BLOCK_COLUMNS_ENCODING;
  readonly count: number;
  readonly rawLine: Uint32Array;
  readonly sendable: Uint32Array;
  readonly kind: Uint8Array;
  /** Exclusive end, in the point columns, of each block's stored points. */
  readonly pointEnd: Uint32Array;
  readonly routeEnd: Float64Array;
  /** N-word of each block, NaN when it has none; null when no block has one. */
  readonly programLine: Float64Array | null;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Null while every stored point's Z is `zConstant`. */
  readonly z: Float64Array | null;
  readonly zConstant: number;
};

/** Read by index or in order; a plain array satisfies it as well. */
export interface IndexedSequence<T> extends Iterable<T> {
  readonly length: number;
  at(index: number): T | undefined;
}

export type MotionBlockSequence = IndexedSequence<MotionBlock>;

/** A view that maps each item when it is read, so a dense program's blocks
 * are never all materialised at once. */
export function mappedSequence<T, U>(
  source: IndexedSequence<T>,
  map: (item: T) => U,
): IndexedSequence<U> {
  return {
    get length() {
      return source.length;
    },
    at(index) {
      const item = source.at(index);
      return item === undefined ? undefined : map(item);
    },
    *[Symbol.iterator]() {
      for (const item of source) yield map(item);
    },
  };
}

export class MotionBlockColumns implements MotionBlockSequence {
  readonly data: MotionBlockColumnData;

  constructor(data: MotionBlockColumnData) {
    this.data = data;
  }

  get length(): number {
    return this.data.count;
  }

  at(index: number): MotionBlock | undefined {
    const block = index < 0 ? this.data.count + index : index;
    if (!Number.isInteger(block) || block < 0 || block >= this.data.count) return undefined;
    const points = this.pointsAt(block);
    const routeStartMm = this.routeStartAt(block);
    return {
      rawLineIndex: this.data.rawLine[block] as number,
      sendableLineIndex: this.data.sendable[block] as number,
      programLineNumber: this.programLineNumberAt(block),
      kind: this.kindAt(block),
      points,
      lengthMm: polylineLength(points),
      routeStartMm,
      routeEndMm: this.data.routeEnd[block] as number,
    };
  }

  *[Symbol.iterator](): Iterator<MotionBlock> {
    for (let index = 0; index < this.data.count; index += 1) {
      yield this.at(index) as MotionBlock;
    }
  }

  kindAt(block: number): MotionBlockKind {
    return MOTION_BLOCK_KINDS[(this.data.kind[block] as number) & KIND_MASK] as MotionBlockKind;
  }

  rawLineIndexAt(block: number): number {
    return this.data.rawLine[block] as number;
  }

  sendableLineIndexAt(block: number): number {
    return this.data.sendable[block] as number;
  }

  programLineNumberAt(block: number): number | null {
    const value = this.data.programLine?.[block];
    return value === undefined || Number.isNaN(value) ? null : value;
  }

  hasProgramLineNumbers(): boolean {
    return this.data.programLine !== null;
  }

  routeStartAt(block: number): number {
    return block === 0 ? 0 : (this.data.routeEnd[block - 1] as number);
  }

  routeEndAt(block: number): number {
    return this.data.routeEnd[block] as number;
  }

  pointCountAt(block: number): number {
    const stored = (this.data.pointEnd[block] as number) - this.storedPointStart(block);
    return stored + (this.sharesStart(block) ? 1 : 0);
  }

  pointsAt(block: number): ReadonlyArray<MotionPoint> {
    const points: MotionPoint[] = [];
    if (this.sharesStart(block)) {
      points.push(this.storedPoint((this.data.pointEnd[block - 1] as number) - 1));
    }
    const end = this.data.pointEnd[block] as number;
    for (let at = this.storedPointStart(block); at < end; at += 1) {
      points.push(this.storedPoint(at));
    }
    return points;
  }

  /** X of the block's point `point` (0 to pointCountAt - 1), without
   * materialising the block: the restart picker walks every point this way. */
  pointXAt(block: number, point: number): number {
    return this.data.x[this.storedIndex(block, point)] as number;
  }

  pointYAt(block: number, point: number): number {
    return this.data.y[this.storedIndex(block, point)] as number;
  }

  private storedIndex(block: number, point: number): number {
    if (!this.sharesStart(block)) return this.storedPointStart(block) + point;
    return point === 0
      ? (this.data.pointEnd[block - 1] as number) - 1
      : this.storedPointStart(block) + point - 1;
  }

  private storedPointStart(block: number): number {
    return block === 0 ? 0 : (this.data.pointEnd[block - 1] as number);
  }

  private sharesStart(block: number): boolean {
    return ((this.data.kind[block] as number) & SHARED_START) !== 0;
  }

  private storedPoint(at: number): MotionPoint {
    return {
      x: this.data.x[at] as number,
      y: this.data.y[at] as number,
      z: this.data.z === null ? this.data.zConstant : (this.data.z[at] as number),
    };
  }
}

export function findMotionBlock(
  blocks: MotionBlockSequence,
  matches: (block: MotionBlock) => boolean,
): MotionBlock | undefined {
  for (const block of blocks) if (matches(block)) return block;
  return undefined;
}

/** Whether any block carries an N-word; columns answer without a walk. */
export function motionBlocksHaveProgramLineNumbers(blocks: MotionBlockSequence): boolean {
  if (blocks instanceof MotionBlockColumns) return blocks.hasProgramLineNumbers();
  for (const block of blocks) if (block.programLineNumber !== null) return true;
  return false;
}

function columnViews(data: MotionBlockColumnData): ReadonlyArray<ArrayBufferView> {
  const views = [
    data.rawLine,
    data.sendable,
    data.kind,
    data.pointEnd,
    data.routeEnd,
    data.x,
    data.y,
  ];
  return [
    ...views,
    ...(data.programLine === null ? [] : [data.programLine]),
    ...(data.z === null ? [] : [data.z]),
  ];
}

/** Transferable buffers, for a postMessage transfer list. */
export function motionBlockColumnBuffers(data: MotionBlockColumnData): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const view of columnViews(data)) {
    if (view.buffer instanceof ArrayBuffer) buffers.add(view.buffer);
  }
  return [...buffers];
}

export function motionBlockColumnBytes(data: MotionBlockColumnData): number {
  return columnViews(data).reduce((total, view) => total + view.byteLength, 0);
}

/** The parser's own route measure, shared so a stored block and a column
 * block report the same `lengthMm` to the last bit. */
export function polylineLength(points: ReadonlyArray<MotionPoint>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) {
      length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
  }
  return length;
}
