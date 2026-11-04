import type { MotionBlock, MotionBlockKind, MotionPoint } from './motion-manifest';
import {
  KIND_MASK,
  MOTION_BLOCK_COLUMNS_ENCODING,
  MOTION_BLOCK_KINDS,
  MotionBlockColumns,
  SHARED_START,
} from './motion-block-columns';

/**
 * Appends blocks in stream order. Capacities are hints: the parser passes the
 * program's line count, since a line yields at most one block, so a laser
 * program's columns are sized once and never copied while it is parsed.
 */
export class MotionBlockColumnsBuilder {
  private count = 0;
  private pointCount = 0;
  private rawLine: Uint32Array;
  private sendable: Uint32Array;
  private kind: Uint8Array;
  private pointEnd: Uint32Array;
  private routeEnd: Float64Array;
  private programLine: Float64Array | null = null;
  private x: Float64Array;
  private y: Float64Array;
  private z: Float64Array | null = null;
  private zConstant: number | undefined;
  private lastPoint: MotionPoint | null = null;

  constructor(blockCapacity: number, pointCapacity = blockCapacity + 1) {
    const blocks = Math.max(1, blockCapacity);
    const points = Math.max(1, pointCapacity);
    this.rawLine = new Uint32Array(blocks);
    this.sendable = new Uint32Array(blocks);
    this.kind = new Uint8Array(blocks);
    this.pointEnd = new Uint32Array(blocks);
    this.routeEnd = new Float64Array(blocks);
    this.x = new Float64Array(points);
    this.y = new Float64Array(points);
  }

  get length(): number {
    return this.count;
  }

  push(block: MotionBlock): void {
    this.ensureBlockCapacity(this.count + 1);
    const index = this.count;
    const shared = this.lastPoint !== null && samePoint(block.points[0], this.lastPoint);
    this.rawLine[index] = block.rawLineIndex;
    this.sendable[index] = block.sendableLineIndex;
    this.kind[index] = MOTION_BLOCK_KINDS.indexOf(block.kind) | (shared ? SHARED_START : 0);
    this.routeEnd[index] = block.routeEndMm;
    if (block.programLineNumber !== null) this.programLines()[index] = block.programLineNumber;
    for (let at = shared ? 1 : 0; at < block.points.length; at += 1) {
      this.pushPoint(block.points[at] as MotionPoint);
    }
    this.pointEnd[index] = this.pointCount;
    this.lastPoint = block.points.at(-1) ?? this.lastPoint;
    this.count += 1;
  }

  kindAt(block: number): MotionBlockKind {
    return MOTION_BLOCK_KINDS[(this.kind[block] as number) & KIND_MASK] as MotionBlockKind;
  }

  rawLineIndexAt(block: number): number {
    return this.rawLine[block] as number;
  }

  setKind(block: number, kind: MotionBlockKind): void {
    const flags = (this.kind[block] as number) & SHARED_START;
    this.kind[block] = MOTION_BLOCK_KINDS.indexOf(kind) | flags;
  }

  lastBlockPoint(): MotionPoint | null {
    return this.lastPoint;
  }

  finish(): MotionBlockColumns {
    const blocks = this.count;
    const points = this.pointCount;
    return new MotionBlockColumns({
      encoding: MOTION_BLOCK_COLUMNS_ENCODING,
      count: blocks,
      rawLine: fitted(this.rawLine, blocks),
      sendable: fitted(this.sendable, blocks),
      kind: fitted(this.kind, blocks),
      pointEnd: fitted(this.pointEnd, blocks),
      routeEnd: fitted(this.routeEnd, blocks),
      programLine: this.programLine === null ? null : fitted(this.programLine, blocks),
      x: fitted(this.x, points),
      y: fitted(this.y, points),
      z: this.z === null ? null : fitted(this.z, points),
      zConstant: this.zConstant ?? 0,
    });
  }

  private pushPoint(point: MotionPoint): void {
    this.ensurePointCapacity(this.pointCount + 1);
    const at = this.pointCount;
    this.x[at] = point.x;
    this.y[at] = point.y;
    if (this.zConstant === undefined) this.zConstant = point.z;
    if (this.z === null && !Object.is(point.z, this.zConstant)) {
      this.z = new Float64Array(this.x.length).fill(this.zConstant);
    }
    if (this.z !== null) this.z[at] = point.z;
    this.pointCount += 1;
  }

  private programLines(): Float64Array {
    this.programLine ??= new Float64Array(this.rawLine.length).fill(Number.NaN);
    return this.programLine;
  }

  private ensureBlockCapacity(required: number): void {
    if (required <= this.rawLine.length) return;
    const capacity = grownCapacity(this.rawLine.length, required);
    this.rawLine = grown(this.rawLine, new Uint32Array(capacity));
    this.sendable = grown(this.sendable, new Uint32Array(capacity));
    this.kind = grown(this.kind, new Uint8Array(capacity));
    this.pointEnd = grown(this.pointEnd, new Uint32Array(capacity));
    this.routeEnd = grown(this.routeEnd, new Float64Array(capacity));
    if (this.programLine !== null) {
      this.programLine = grown(this.programLine, new Float64Array(capacity).fill(Number.NaN));
    }
  }

  private ensurePointCapacity(required: number): void {
    if (required <= this.x.length) return;
    const capacity = grownCapacity(this.x.length, required);
    this.x = grown(this.x, new Float64Array(capacity));
    this.y = grown(this.y, new Float64Array(capacity));
    if (this.z !== null) this.z = grown(this.z, new Float64Array(capacity));
  }
}

function samePoint(a: MotionPoint | undefined, b: MotionPoint): boolean {
  return a !== undefined && Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);
}

function grownCapacity(current: number, required: number): number {
  return Math.max(required, Math.ceil(current * 1.5) + 16);
}

function grown<T extends Uint8Array | Uint32Array | Float64Array>(from: T, to: T): T {
  to.set(from);
  return to;
}

/** A column is kept as allocated when it is nearly full; otherwise it is
 * copied to its length, so a sparse program does not keep its line count. */
function fitted<T extends Uint8Array | Uint32Array | Float64Array>(column: T, length: number): T {
  if (length === column.length) return column;
  if (length >= column.length * 0.9) return column.subarray(0, length) as T;
  return column.slice(0, length) as T;
}

/** Columns for blocks held as objects: fixtures and legacy archives. */
export function motionBlockColumnsFrom(
  blocks: Iterable<MotionBlock>,
  count: number,
): MotionBlockColumns {
  const builder = new MotionBlockColumnsBuilder(count);
  for (const block of blocks) builder.push(block);
  return builder.finish();
}
