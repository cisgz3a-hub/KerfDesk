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
import { isMotionBlockColumnData } from '../../../core/job/motion-block-columns-validation';
import { assertExecutionArtifactSizeWithinBudget } from './execution-artifact-size';
import {
  hasValidSummary,
  isLegacyPackedMotionManifest,
  unpackLegacyMotionManifest,
  type LegacyPackedMotionManifest,
} from './packed-motion-manifest-v1';

const ENCODING = 'packed-motion-manifest-v2';

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
  if (manifest.blocks instanceof MotionBlockColumns) {
    return motionBlockColumnBytes(manifest.blocks.data);
  }
  return objectBlockColumnBytes(manifest.blocks);
}

export function packMotionManifest(
  manifest: MotionManifest,
  options: PackMotionManifestOptions = {},
): PackedMotionManifest {
  // Bound allocations before constructing any column. The complete artifact is
  // measured again with these exact stored buffers before persistence.
  if (options.enforceArchiveBudget !== false) {
    assertExecutionArtifactSizeWithinBudget({}, packedMotionManifestBytes(manifest));
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

export function isPackedMotionManifest(
  value: unknown,
  limits?: { readonly rawLines: number; readonly sendableLines: number },
): value is PackedMotionManifest {
  if (!isRecord(value) || value['encoding'] !== ENCODING) return false;
  if (!hasValidSummary(value, limits?.sendableLines)) return false;
  const columns = value['columns'];
  if (
    !isMotionBlockColumnData(columns, {
      ...(limits === undefined ? {} : { rawLines: limits.rawLines }),
      sendableLines: value.sendableLineCount,
    })
  ) {
    return false;
  }
  const lastRouteEnd = columns.count === 0 ? 0 : columns.routeEnd[columns.count - 1];
  return lastRouteEnd === value.totalRouteMm;
}

/** Archives from builds before ADR-244 Amendment 3 hold the v1 encoding. */
export function isArchivedPackedMotionManifest(
  value: unknown,
  limits?: { readonly rawLines: number; readonly sendableLines: number },
): value is ArchivedPackedMotionManifest {
  return isPackedMotionManifest(value, limits) || isLegacyPackedMotionManifest(value, limits);
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
function objectBlockColumnBytes(blocks: MotionBlockSequence): number {
  let stored = 0;
  let programLines = false;
  let zVaries = false;
  let firstZ: number | undefined;
  let last: MotionPoint | undefined;
  for (const block of blocks) {
    const shared = last !== undefined && samePoint(block.points[0], last);
    for (let at = shared ? 1 : 0; at < block.points.length; at += 1) {
      const z = (block.points[at] as MotionPoint).z;
      firstZ ??= z;
      zVaries ||= !Object.is(z, firstZ);
      stored += 1;
    }
    programLines ||= block.programLineNumber !== null;
    last = block.points.at(-1) ?? last;
  }
  const perBlock = 4 + 4 + 1 + 4 + 8 + (programLines ? 8 : 0);
  return blocks.length * perBlock + stored * (zVaries ? 24 : 16);
}

function samePoint(a: MotionPoint | undefined, b: MotionPoint): boolean {
  return a !== undefined && Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
