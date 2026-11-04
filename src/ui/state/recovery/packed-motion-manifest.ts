import type {
  MotionBlock,
  MotionBlockKind,
  MotionManifest,
  MotionPoint,
} from '../../../core/job/motion-manifest';
import { runWorkSteps, type WorkSteps } from '../../../core/recovery/work-steps';
import { assertExecutionArtifactSizeWithinBudget } from './execution-artifact-size';

const ENCODING = 'packed-motion-manifest-v1';
const BLOCK_WIDTH = 10;
/** Doubles per stored point: x, y, z. */
export const PACKED_POINT_WIDTH = 3;
const KINDS: ReadonlyArray<MotionBlockKind> = ['travel', 'process', 'plunge', 'park'];
/** Blocks plus points visited between checkpoints (ADR-337 Amendment 1). */
const MANIFEST_STEP_UNITS = 1 << 14;
/** Stored doubles checked between checkpoints. */
const DATA_STEP_VALUES = 1 << 16;

/** All numbers retain their original IEEE-754 doubles. Each block stores raw
 * line, sendable line, kind, point offset/count, N-word presence/value, length,
 * and route start/end. Points store x/y/z triples; no path is simplified. */
export type PackedMotionManifest = Omit<MotionManifest, 'blocks'> & {
  readonly encoding: typeof ENCODING;
  readonly blockData: Float64Array;
  readonly pointData: Float64Array;
};

/** Bytes the packed encoding of `manifest` occupies, without allocating it.
 * One pass over the block list; no point is visited. A plain (unpacked)
 * manifest is charged at least this much by the artifact estimator, so the
 * figure is a lower bound on any archive that embeds the manifest. */
export function packedMotionManifestBytes(manifest: MotionManifest): number {
  return runWorkSteps(packedMotionManifestBytesSteps(manifest));
}

export function* packedMotionManifestBytesSteps(manifest: MotionManifest): WorkSteps<number> {
  return packedBytes(manifest.blocks.length, yield* manifestPointCountSteps(manifest));
}

function packedBytes(blockCount: number, pointCount: number): number {
  return (
    (blockCount * BLOCK_WIDTH + pointCount * PACKED_POINT_WIDTH) * Float64Array.BYTES_PER_ELEMENT
  );
}

function* manifestPointCountSteps(manifest: MotionManifest): WorkSteps<number> {
  let pointCount = 0;
  let work = 0;
  for (const block of manifest.blocks) {
    pointCount += block.points.length;
    work += 1;
    if (work >= MANIFEST_STEP_UNITS) {
      work = 0;
      yield;
    }
  }
  return pointCount;
}

export type PackMotionManifestOptions = {
  /** Archives must fit the per-artifact budget; transient previews need not. */
  readonly enforceArchiveBudget?: boolean;
};

export function packMotionManifest(
  manifest: MotionManifest,
  options: PackMotionManifestOptions = {},
): PackedMotionManifest {
  return runWorkSteps(packMotionManifestSteps(manifest, options));
}

export function* packMotionManifestSteps(
  manifest: MotionManifest,
  options: PackMotionManifestOptions = {},
): WorkSteps<PackedMotionManifest> {
  const pointCount = yield* manifestPointCountSteps(manifest);
  // Bound allocations before constructing either buffer. The complete artifact
  // is measured again with these exact stored buffers before persistence.
  if (options.enforceArchiveBudget !== false) {
    assertExecutionArtifactSizeWithinBudget({}, packedBytes(manifest.blocks.length, pointCount));
  }
  const blockData = new Float64Array(manifest.blocks.length * BLOCK_WIDTH);
  const pointData = new Float64Array(pointCount * PACKED_POINT_WIDTH);
  let pointOffset = 0;
  let work = 0;
  for (let index = 0; index < manifest.blocks.length; index += 1) {
    const block = manifest.blocks[index] as MotionBlock;
    const at = index * BLOCK_WIDTH;
    blockData[at] = block.rawLineIndex;
    blockData[at + 1] = block.sendableLineIndex;
    blockData[at + 2] = KINDS.indexOf(block.kind);
    blockData[at + 3] = pointOffset;
    blockData[at + 4] = block.points.length;
    blockData[at + 5] = block.programLineNumber === null ? 0 : 1;
    blockData[at + 6] = block.programLineNumber ?? 0;
    blockData[at + 7] = block.lengthMm;
    blockData[at + 8] = block.routeStartMm;
    blockData[at + 9] = block.routeEndMm;
    for (const point of block.points) {
      const stored = pointOffset * PACKED_POINT_WIDTH;
      pointData[stored] = point.x;
      pointData[stored + 1] = point.y;
      pointData[stored + 2] = point.z;
      pointOffset += 1;
    }
    work += 1 + block.points.length;
    if (work >= MANIFEST_STEP_UNITS) {
      work = 0;
      yield;
    }
  }
  const { blocks, ...summary } = manifest;
  void blocks;
  const packed = { ...summary, encoding: ENCODING, blockData, pointData } as const;
  if (!(yield* isPackedMotionManifestSteps(packed)))
    throw new Error('Cannot archive an invalid motion manifest.');
  return packed;
}

export type PackedMotionManifestLimits = {
  readonly rawLines: number;
  readonly sendableLines: number;
};

export function isPackedMotionManifest(
  value: unknown,
  limits?: PackedMotionManifestLimits,
): value is PackedMotionManifest {
  return runWorkSteps(isPackedMotionManifestSteps(value, limits));
}

export function* isPackedMotionManifestSteps(
  value: unknown,
  limits?: PackedMotionManifestLimits,
): WorkSteps<boolean> {
  if (!isRecord(value) || value['encoding'] !== ENCODING) return false;
  const blockData = value['blockData'];
  const pointData = value['pointData'];
  if (!isFloat64Array(blockData) || !isFloat64Array(pointData)) return false;
  if (blockData.length % BLOCK_WIDTH !== 0 || pointData.length % PACKED_POINT_WIDTH !== 0)
    return false;
  if (!hasValidSummary(value, limits?.sendableLines)) return false;
  if (!(yield* allFiniteSteps(pointData))) return false;
  return yield* validBlocksSteps(
    blockData,
    pointData.length / PACKED_POINT_WIDTH,
    value.totalRouteMm,
    value.sendableLineCount,
    limits?.rawLines,
  );
}

function* allFiniteSteps(data: Float64Array): WorkSteps<boolean> {
  for (let start = 0; start < data.length; start += DATA_STEP_VALUES) {
    const end = Math.min(data.length, start + DATA_STEP_VALUES);
    for (let index = start; index < end; index += 1) {
      if (!Number.isFinite(data[index])) return false;
    }
    if (end < data.length) yield;
  }
  return true;
}

function hasValidSummary(
  value: Record<string, unknown>,
  sendableLines: number | undefined,
): value is Record<string, unknown> & Omit<MotionManifest, 'blocks'> {
  return (
    isNonNegativeNumber(value['totalRouteMm']) &&
    isIndex(value['sendableLineCount']) &&
    (sendableLines === undefined || value['sendableLineCount'] === sendableLines) &&
    isNullablePoint(value['firstProcessPoint']) &&
    isNullablePoint(value['finalPoint'])
  );
}

function* validBlocksSteps(
  data: Float64Array,
  pointCount: number,
  totalRoute: number,
  sendableLines: number,
  rawLines = Number.MAX_SAFE_INTEGER,
): WorkSteps<boolean> {
  let nextPoint = 0;
  let previousRaw = -1;
  let previousSendable = -1;
  let route = 0;
  let checkpoint = DATA_STEP_VALUES;
  for (let index = 0; index < data.length; index += BLOCK_WIDTH) {
    if (index >= checkpoint) {
      checkpoint = index + DATA_STEP_VALUES;
      yield;
    }
    if (!validLineIndices(data, index, previousRaw, previousSendable, rawLines, sendableLines))
      return false;
    if (!validPointReference(data, index, nextPoint) || !validProgramNumber(data, index))
      return false;
    if (!validRouteRange(data, index, route)) return false;
    nextPoint += data[index + 4] as number;
    if (nextPoint > pointCount) return false;
    previousRaw = data[index] as number;
    previousSendable = data[index + 1] as number;
    route = data[index + 9] as number;
  }
  return nextPoint === pointCount && route === totalRoute;
}

function validLineIndices(
  data: Float64Array,
  index: number,
  previousRaw: number,
  previousSendable: number,
  rawLines: number,
  sendableLines: number,
): boolean {
  const raw = data[index];
  const sendable = data[index + 1];
  return (
    isIndex(raw) &&
    raw > previousRaw &&
    raw < rawLines &&
    isIndex(sendable) &&
    sendable > previousSendable &&
    sendable < sendableLines &&
    sendable <= raw
  );
}

function validPointReference(data: Float64Array, index: number, nextPoint: number): boolean {
  const kind = data[index + 2];
  const count = data[index + 4];
  return (
    isIndex(kind) &&
    kind < KINDS.length &&
    data[index + 3] === nextPoint &&
    isIndex(count) &&
    count >= 2
  );
}

function validProgramNumber(data: Float64Array, index: number): boolean {
  const present = data[index + 5];
  const number = data[index + 6];
  return (
    (present === 0 || present === 1) && Number.isFinite(number) && (present !== 0 || number === 0)
  );
}

function validRouteRange(data: Float64Array, index: number, route: number): boolean {
  const length = data[index + 7];
  const end = data[index + 9];
  return (
    isNonNegativeNumber(length) &&
    data[index + 8] === route &&
    isNonNegativeNumber(end) &&
    end === route + length
  );
}

/** Columnar readers: consumers such as the restart picker walk a packed route
 * directly instead of materialising one object per point. Callers pass indices
 * from `packedBlockCount`; the layout stays private to this module. */
export function packedBlockCount(packed: PackedMotionManifest): number {
  return packed.blockData.length / BLOCK_WIDTH;
}

export function packedBlockRawLineIndex(packed: PackedMotionManifest, block: number): number {
  return packed.blockData[block * BLOCK_WIDTH] as number;
}

export function packedBlockSendableLineIndex(packed: PackedMotionManifest, block: number): number {
  return packed.blockData[block * BLOCK_WIDTH + 1] as number;
}

export function packedBlockKind(packed: PackedMotionManifest, block: number): MotionBlockKind {
  return KINDS[packed.blockData[block * BLOCK_WIDTH + 2] as number] as MotionBlockKind;
}

export function packedBlockPointOffset(packed: PackedMotionManifest, block: number): number {
  return packed.blockData[block * BLOCK_WIDTH + 3] as number;
}

export function packedBlockPointCount(packed: PackedMotionManifest, block: number): number {
  return packed.blockData[block * BLOCK_WIDTH + 4] as number;
}

export function packedPoint(packed: PackedMotionManifest, point: number): MotionPoint {
  const at = point * PACKED_POINT_WIDTH;
  return {
    x: packed.pointData[at] as number,
    y: packed.pointData[at + 1] as number,
    z: packed.pointData[at + 2] as number,
  };
}

export function unpackMotionManifest(packed: PackedMotionManifest): MotionManifest {
  if (!isPackedMotionManifest(packed)) throw new Error('The archived motion manifest is invalid.');
  const blocks: MotionBlock[] = [];
  const data = packed.blockData;
  for (let index = 0; index < data.length; index += BLOCK_WIDTH) {
    const points: MotionPoint[] = [];
    const offset = data[index + 3] as number;
    const count = data[index + 4] as number;
    for (let point = offset; point < offset + count; point += 1) {
      points.push(packedPoint(packed, point));
    }
    blocks.push({
      rawLineIndex: data[index] as number,
      sendableLineIndex: data[index + 1] as number,
      kind: KINDS[data[index + 2] as number] as MotionBlockKind,
      points,
      programLineNumber: data[index + 5] === 0 ? null : (data[index + 6] as number),
      lengthMm: data[index + 7] as number,
      routeStartMm: data[index + 8] as number,
      routeEndMm: data[index + 9] as number,
    });
  }
  return {
    blocks,
    totalRouteMm: packed.totalRouteMm,
    sendableLineCount: packed.sendableLineCount,
    firstProcessPoint: packed.firstProcessPoint,
    finalPoint: packed.finalPoint,
  };
}

export function hasPackedMotionEncoding(value: unknown): boolean {
  return isRecord(value) && 'encoding' in value;
}

function isFloat64Array(value: unknown): value is Float64Array {
  // IndexedDB and jsdom structured clone may return a different realm's view.
  return (
    ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Float64Array]'
  );
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullablePoint(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis])))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
