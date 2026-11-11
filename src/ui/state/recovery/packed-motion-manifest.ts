import type {
  MotionBlockKind,
  MotionManifest,
  MotionPoint,
} from '../../../core/job/motion-manifest';
import {
  MotionBlockColumns,
  motionBlockColumnBuffers,
  motionBlockColumnBytes,
  type MotionBlockColumnData,
  type MotionBlockSequence,
} from '../../../core/job/motion-block-columns';
import { motionBlockColumnsFrom } from '../../../core/job/motion-block-columns-builder';
import { isMotionBlockColumnDataSteps } from '../../../core/job/motion-block-columns-validation';
import { runWorkSteps, type WorkSteps } from '../../../core/recovery/work-steps';
import { assertExecutionArtifactSizeWithinBudget } from './execution-artifact-size';
import {
  hasValidSummary,
  isLegacyPackedMotionManifest,
  unpackLegacyMotionManifest,
  type LegacyPackedMotionManifest,
} from './packed-motion-manifest-v1';
import { isRecord } from '../../../core/util/is-record';

const ENCODING = 'packed-motion-manifest-v2';
/** Object blocks measured per step of the accepted run's archive (ADR-337 Amendment 1). */
const MEASURE_STEP_BLOCKS = 1 << 14;

/** A manifest as it crosses a structured clone: its summary and its block
 * columns, exact to the last bit (ADR-244 Amendment 3). Packing columns the
 * parser built copies nothing, and the columns' buffers can be transferred. */
export type PackedMotionManifest = Omit<MotionManifest, 'blocks'> & {
  readonly encoding: typeof ENCODING;
  readonly columns: MotionBlockColumnData;
};

export type ArchivedPackedMotionManifest = PackedMotionManifest | LegacyPackedMotionManifest;

export type PackMotionManifestOptions = {
  /** Archives must fit the per-artifact budget; transient previews need not. */
  readonly enforceArchiveBudget?: boolean;
};

/** Bytes the packed columns of `manifest` occupy. Columns report their own
 * size; blocks held as objects are measured without building columns. */
export function packedMotionManifestBytes(manifest: MotionManifest): number {
  return runWorkSteps(packedMotionManifestBytesSteps(manifest));
}

export function* packedMotionManifestBytesSteps(manifest: MotionManifest): WorkSteps<number> {
  if (manifest.blocks instanceof MotionBlockColumns) {
    return motionBlockColumnBytes(manifest.blocks.data);
  }
  return yield* objectBlockColumnBytesSteps(manifest.blocks);
}

export function packMotionManifest(
  manifest: MotionManifest,
  options: PackMotionManifestOptions = {},
): PackedMotionManifest {
  return runWorkSteps(packMotionManifestSteps(manifest, options));
}

/** Packing columns copies nothing; only measuring object blocks is a walk. */
export function* packMotionManifestSteps(
  manifest: MotionManifest,
  options: PackMotionManifestOptions = {},
): WorkSteps<PackedMotionManifest> {
  // Bound allocations before constructing any column. The complete artifact is
  // measured again with these exact stored buffers before persistence.
  if (options.enforceArchiveBudget !== false) {
    assertExecutionArtifactSizeWithinBudget({}, yield* packedMotionManifestBytesSteps(manifest));
  }
  const columns =
    manifest.blocks instanceof MotionBlockColumns
      ? manifest.blocks
      : motionBlockColumnsFrom(manifest.blocks, manifest.blocks.length);
  return {
    encoding: ENCODING,
    totalRouteMm: manifest.totalRouteMm,
    sendableLineCount: manifest.sendableLineCount,
    firstProcessPoint: manifest.firstProcessPoint,
    finalPoint: manifest.finalPoint,
    columns: columns.data,
  };
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
  if (!hasValidSummary(value, limits?.sendableLines)) return false;
  const columns = value['columns'];
  const valid = yield* isMotionBlockColumnDataSteps(columns, {
    ...(limits === undefined ? {} : { rawLines: limits.rawLines }),
    sendableLines: value.sendableLineCount,
  });
  if (!valid) return false;
  const data = columns as MotionBlockColumnData;
  const lastRouteEnd = data.count === 0 ? 0 : data.routeEnd[data.count - 1];
  return lastRouteEnd === value.totalRouteMm;
}

/** Archives from builds before ADR-244 Amendment 3 hold the v1 encoding. */
export function isArchivedPackedMotionManifest(
  value: unknown,
  limits?: PackedMotionManifestLimits,
): value is ArchivedPackedMotionManifest {
  return runWorkSteps(isArchivedPackedMotionManifestSteps(value, limits));
}

/** Only the current encoding is stepped: a run archives v2, and v1 is read back. */
export function* isArchivedPackedMotionManifestSteps(
  value: unknown,
  limits?: PackedMotionManifestLimits,
): WorkSteps<boolean> {
  return (
    (yield* isPackedMotionManifestSteps(value, limits)) ||
    isLegacyPackedMotionManifest(value, limits)
  );
}

export function unpackMotionManifest(packed: ArchivedPackedMotionManifest): MotionManifest {
  if (packed.encoding !== ENCODING) return unpackLegacyMotionManifest(packed);
  if (!isPackedMotionManifest(packed)) throw new Error('The archived motion manifest is invalid.');
  return manifestFromColumns(packed);
}

/** The preparation worker's own handoff: the same application built these
 * columns a moment ago, so they are wrapped as they arrive. Walking an 8 M
 * line photo's columns to validate them would hold the window for seconds;
 * archives and other threads' replies go through `unpackMotionManifest`. */
export function unpackTrustedMotionManifest(packed: PackedMotionManifest): MotionManifest {
  if (packed.encoding !== ENCODING) throw new Error('The motion manifest handoff is invalid.');
  return manifestFromColumns(packed);
}

export function packedManifestTransferables(packed: PackedMotionManifest): ArrayBuffer[] {
  return motionBlockColumnBuffers(packed.columns);
}

export function hasPackedMotionEncoding(value: unknown): boolean {
  return isRecord(value) && 'encoding' in value;
}

/** The encoding tag only; the content is not validated. */
export function hasColumnPackedEncoding(value: unknown): value is PackedMotionManifest {
  return isRecord(value) && value['encoding'] === ENCODING;
}

/** Columnar readers: the restart picker walks a packed route directly instead
 * of materialising one object per point. Points are numbered 0 to
 * `packedBlockPointCount - 1` within their block. */
export function packedBlockCount(packed: PackedMotionManifest): number {
  return packed.columns.count;
}

export function packedBlockRawLineIndex(packed: PackedMotionManifest, block: number): number {
  return columnsOf(packed).rawLineIndexAt(block);
}

export function packedBlockSendableLineIndex(packed: PackedMotionManifest, block: number): number {
  return columnsOf(packed).sendableLineIndexAt(block);
}

export function packedBlockKind(packed: PackedMotionManifest, block: number): MotionBlockKind {
  return columnsOf(packed).kindAt(block);
}

export function packedBlockPointCount(packed: PackedMotionManifest, block: number): number {
  return columnsOf(packed).pointCountAt(block);
}

export function packedBlockPointX(packed: PackedMotionManifest, block: number, point: number) {
  return columnsOf(packed).pointXAt(block, point);
}

export function packedBlockPointY(packed: PackedMotionManifest, block: number, point: number) {
  return columnsOf(packed).pointYAt(block, point);
}

export function packedBlockPoints(
  packed: PackedMotionManifest,
  block: number,
): ReadonlyArray<MotionPoint> {
  return columnsOf(packed).pointsAt(block);
}

const columnViews = new WeakMap<MotionBlockColumnData, MotionBlockColumns>();

function columnsOf(packed: PackedMotionManifest): MotionBlockColumns {
  const cached = columnViews.get(packed.columns);
  if (cached !== undefined) return cached;
  const columns = new MotionBlockColumns(packed.columns);
  columnViews.set(packed.columns, columns);
  return columns;
}

function manifestFromColumns(packed: PackedMotionManifest): MotionManifest {
  return {
    blocks: columnsOf(packed),
    totalRouteMm: packed.totalRouteMm,
    sendableLineCount: packed.sendableLineCount,
    firstProcessPoint: packed.firstProcessPoint,
    finalPoint: packed.finalPoint,
  };
}

/** What `motionBlockColumnsFrom` would allocate, counted exactly. */
function* objectBlockColumnBytesSteps(blocks: MotionBlockSequence): WorkSteps<number> {
  const count: StoredPointCount = { stored: 0, zVaries: false, firstZ: undefined };
  let programLines = false;
  let last: MotionPoint | undefined;
  let visited = 0;
  for (const block of blocks) {
    if (visited > 0 && visited % MEASURE_STEP_BLOCKS === 0) yield;
    visited += 1;
    const shared = last !== undefined && samePoint(block.points[0], last);
    countStoredPoints(count, block.points, shared ? 1 : 0);
    programLines ||= block.programLineNumber !== null;
    last = block.points.at(-1) ?? last;
  }
  const perBlock = 4 + 4 + 1 + 4 + 8 + (programLines ? 8 : 0);
  return blocks.length * perBlock + count.stored * (count.zVaries ? 24 : 16);
}

type StoredPointCount = { stored: number; zVaries: boolean; firstZ: number | undefined };

function countStoredPoints(
  count: StoredPointCount,
  points: ReadonlyArray<MotionPoint>,
  from: number,
): void {
  for (let at = from; at < points.length; at += 1) {
    const z = (points[at] as MotionPoint).z;
    count.firstZ ??= z;
    count.zVaries ||= !Object.is(z, count.firstZ);
    count.stored += 1;
  }
}

function samePoint(a: MotionPoint | undefined, b: MotionPoint): boolean {
  return a !== undefined && Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);
}
