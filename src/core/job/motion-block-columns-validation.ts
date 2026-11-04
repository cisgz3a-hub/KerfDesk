import {
  KIND_MASK,
  MOTION_BLOCK_COLUMNS_ENCODING,
  MOTION_BLOCK_KINDS,
  MotionBlockColumns,
  SHARED_START,
  type MotionBlockColumnData,
} from './motion-block-columns';
import { runWorkSteps, type WorkSteps } from '../recovery/work-steps';

// Checkpoints for the accepted run's archive (ADR-337 Amendment 1): blocks and
// stored values a step may visit before the next yield.
const BLOCK_STEP = 1 << 14;
const VALUE_STEP = 1 << 16;

export type MotionBlockColumnLimits = {
  readonly rawLines: number;
  readonly sendableLines: number;
};

/**
 * Accepts columns read back from storage or another thread only when every
 * block keeps the parser's invariants: raw and sendable lines rise strictly,
 * a sendable index never passes its raw line, each block has two or more
 * finite points, and its route end is its route start plus its own length.
 */
export function isMotionBlockColumnData(
  value: unknown,
  limits?: Partial<MotionBlockColumnLimits>,
): value is MotionBlockColumnData {
  return runWorkSteps(isMotionBlockColumnDataSteps(value, limits));
}

/** `isMotionBlockColumnData` as resumable steps; a yield is a checkpoint. */
export function* isMotionBlockColumnDataSteps(
  value: unknown,
  limits?: Partial<MotionBlockColumnLimits>,
): WorkSteps<boolean> {
  if (!(yield* hasColumnShapeSteps(value))) return false;
  const data = value as MotionBlockColumnData;
  const columns = new MotionBlockColumns(data);
  const rawLines = limits?.rawLines ?? Number.MAX_SAFE_INTEGER;
  const sendableLines = limits?.sendableLines ?? Number.MAX_SAFE_INTEGER;
  for (let block = 0; block < data.count; block += 1) {
    if (block > 0 && block % BLOCK_STEP === 0) yield;
    if (!validBlock(columns, block, rawLines, sendableLines)) return false;
  }
  const storedPoints = data.count === 0 ? 0 : (data.pointEnd[data.count - 1] as number);
  return storedPoints === data.x.length;
}

function validBlock(
  columns: MotionBlockColumns,
  block: number,
  rawLines: number,
  sendableLines: number,
): boolean {
  const data = columns.data;
  return (
    validBlockFlags(data, block) &&
    validLines(data, block, rawLines, sendableLines) &&
    validPointRange(data, block) &&
    validRoute(columns, block)
  );
}

function* hasColumnShapeSteps(value: unknown): WorkSteps<boolean> {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  const count = data['count'];
  if (data['encoding'] !== MOTION_BLOCK_COLUMNS_ENCODING || !isIndex(count)) return false;
  return hasBlockColumns(data, count) && (yield* hasPointColumnsSteps(data));
}

function hasBlockColumns(data: Record<string, unknown>, count: number): boolean {
  return (
    isView(data['rawLine'], '[object Uint32Array]', count) &&
    isView(data['sendable'], '[object Uint32Array]', count) &&
    isView(data['kind'], '[object Uint8Array]', count) &&
    isView(data['pointEnd'], '[object Uint32Array]', count) &&
    isView(data['routeEnd'], '[object Float64Array]', count) &&
    (data['programLine'] === null || isView(data['programLine'], '[object Float64Array]', count))
  );
}

function* hasPointColumnsSteps(data: Record<string, unknown>): WorkSteps<boolean> {
  if (!isView(data['x'], '[object Float64Array]')) return false;
  const points = (data['x'] as Float64Array).length;
  const z = data['z'];
  if (z !== null && !isView(z, '[object Float64Array]', points)) return false;
  return (
    isView(data['y'], '[object Float64Array]', points) &&
    Number.isFinite(data['zConstant']) &&
    (yield* finiteColumnSteps(data['x'] as Float64Array)) &&
    (yield* finiteColumnSteps(data['y'] as Float64Array)) &&
    (z === null || (yield* finiteColumnSteps(z as Float64Array)))
  );
}

function validBlockFlags(data: MotionBlockColumnData, block: number): boolean {
  const kind = data.kind[block] as number;
  if ((kind & ~(KIND_MASK | SHARED_START)) !== 0) return false;
  if ((kind & KIND_MASK) >= MOTION_BLOCK_KINDS.length) return false;
  const programLine = data.programLine?.[block];
  return programLine === undefined || Number.isNaN(programLine) || Number.isFinite(programLine);
}

function validLines(
  data: MotionBlockColumnData,
  block: number,
  rawLines: number,
  sendableLines: number,
): boolean {
  const raw = data.rawLine[block] as number;
  const sendable = data.sendable[block] as number;
  if (raw >= rawLines || sendable >= sendableLines || sendable > raw) return false;
  if (block === 0) return true;
  return (
    raw > (data.rawLine[block - 1] as number) && sendable > (data.sendable[block - 1] as number)
  );
}

function validPointRange(data: MotionBlockColumnData, block: number): boolean {
  const start = block === 0 ? 0 : (data.pointEnd[block - 1] as number);
  const end = data.pointEnd[block] as number;
  const shared = ((data.kind[block] as number) & SHARED_START) !== 0;
  if (shared && block === 0) return false;
  return end >= start && end <= data.x.length && end - start + (shared ? 1 : 0) >= 2;
}

function validRoute(columns: MotionBlockColumns, block: number): boolean {
  const start = columns.routeStartAt(block);
  const end = columns.routeEndAt(block);
  const length = columns.at(block)?.lengthMm ?? Number.NaN;
  return Number.isFinite(end) && length >= 0 && end === start + length;
}

function isView(value: unknown, tag: string, length?: number): boolean {
  // IndexedDB and jsdom structured clone may return another realm's view.
  if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== tag) return false;
  return length === undefined || (value as unknown as { length: number }).length === length;
}

function* finiteColumnSteps(column: Float64Array): WorkSteps<boolean> {
  for (let start = 0; start < column.length; start += VALUE_STEP) {
    if (start > 0) yield;
    if (!column.subarray(start, start + VALUE_STEP).every(Number.isFinite)) return false;
  }
  return true;
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
