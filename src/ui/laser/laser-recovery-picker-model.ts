import type { MotionPoint } from '../../core/job/motion-manifest';
import type { Vec2 } from '../../core/scene';
import { mapControllerPointToScene } from '../state/canvas-motion-plan';
import {
  PACKED_POINT_WIDTH,
  packedBlockCount,
  packedBlockKind,
  packedBlockPointCount,
  packedBlockPointOffset,
  packedBlockRawLineIndex,
  packedBlockSendableLineIndex,
  packedPoint,
  type PackedMotionManifest,
} from '../state/recovery/packed-motion-manifest';
import type { RecoveryPreviewRoute } from './laser-recovery-preview-route';

export type RecoveryPreviewView = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** One original movement, materialised only for the highlighted selection. */
export type RecoveryMovement = {
  readonly blockIndex: number;
  /** One-based line in the sealed program, as the operator enters it. */
  readonly rawLine: number;
  readonly points: ReadonlyArray<MotionPoint>;
};

export const RECOVERY_PREVIEW_SEGMENT_LIMIT = 2_000;
const BLOCKS_PER_PREVIEW_CHUNK = 256;

type RecoveryPreviewIndex = {
  readonly bounds: Float64Array;
  readonly offset: Vec2;
  readonly scaleX: number;
  readonly scaleY: number;
};

type SegmentVisitor = (x1: number, y1: number, x2: number, y2: number, block: number) => void;

const previewIndexes = new WeakMap<RecoveryPreviewRoute, RecoveryPreviewIndex>();

/** Borrow the packed route. Never clone its potentially millions of points. */
export function recoveryPreviewBounds(route: RecoveryPreviewRoute): RecoveryPreviewView | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const { bounds } = recoveryPreviewIndex(route);
  for (let index = 0; index < bounds.length; index += 4) {
    minX = Math.min(minX, bounds[index] ?? Infinity);
    minY = Math.min(minY, bounds[index + 1] ?? Infinity);
    maxX = Math.max(maxX, bounds[index + 2] ?? -Infinity);
    maxY = Math.max(maxY, bounds[index + 3] ?? -Infinity);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const width = Math.max(2, maxX - minX, (maxY - minY) * 2) * 1.12;
  const height = width / 2;
  return { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height };
}

type PreviewSegment = { readonly from: Vec2; readonly to: Vec2 };

/** A deterministic bounded reservoir, resampled for the visible area after zoom.
 * Display simplification never changes hit testing or the selected raw line. */
export function recoveryPreviewPath(
  route: RecoveryPreviewRoute,
  view: RecoveryPreviewView,
): { readonly path: string; readonly sampled: boolean; readonly shown: number } {
  const segments: PreviewSegment[] = [];
  let visible = 0;
  walkProcessSegments(
    route,
    (x1, y1, x2, y2) => {
      if (!intersectsView(x1, y1, x2, y2, view)) return;
      visible += 1;
      if (segments.length < RECOVERY_PREVIEW_SEGMENT_LIMIT) {
        segments.push({ from: { x: x1, y: y1 }, to: { x: x2, y: y2 } });
        return;
      }
      // Integer hashing gives stable sampling without allocating a full route or
      // depending on random state. At most the fixed reservoir is retained.
      const slot = (Math.imul(visible, 2_654_435_761) >>> 0) % visible;
      if (slot < RECOVERY_PREVIEW_SEGMENT_LIMIT) {
        segments[slot] = { from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
      }
    },
    view,
  );
  return {
    path: segments.map(({ from, to }) => `M${from.x},${from.y}L${to.x},${to.y}`).join(''),
    sampled: visible > RECOVERY_PREVIEW_SEGMENT_LIMIT,
    shown: segments.length,
  };
}

/** Source-line distance breaks coincident-pass ties; every original segment is
 * tested, including movements omitted from the bounded display. */
export function pickRecoveryMovement(
  route: RecoveryPreviewRoute,
  point: Vec2,
  toleranceMm: number,
  preferredRawLine: number,
): number | null {
  let distance = toleranceMm * toleranceMm;
  let rawLine: number | null = null;
  walkProcessSegments(
    route,
    (x1, y1, x2, y2, block) => {
      const candidate = segmentDistanceSquared(point, x1, y1, x2, y2);
      const line = packedBlockRawLineIndex(route.manifest, block) + 1;
      const nearerLine =
        rawLine === null ||
        Math.abs(line - preferredRawLine) < Math.abs(rawLine - preferredRawLine);
      if (candidate < distance - 1e-12 || (Math.abs(candidate - distance) <= 1e-12 && nearerLine)) {
        distance = candidate;
        rawLine = line;
      }
    },
    {
      x: point.x - toleranceMm,
      y: point.y - toleranceMm,
      width: 2 * toleranceMm,
      height: 2 * toleranceMm,
    },
  );
  return rawLine;
}

export function firstRecoveryMovement(
  route: RecoveryPreviewRoute,
  rawLine: number,
): RecoveryMovement | null {
  const manifest = route.manifest;
  const count = packedBlockCount(manifest);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (packedBlockRawLineIndex(manifest, middle) < rawLine - 1) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < count; index += 1) {
    if (packedBlockKind(manifest, index) !== 'process') continue;
    const offset = packedBlockPointOffset(manifest, index);
    const pointCount = packedBlockPointCount(manifest, index);
    const points: MotionPoint[] = [];
    for (let point = 0; point < pointCount; point += 1) {
      points.push(packedPoint(manifest, offset + point));
    }
    return { blockIndex: index, rawLine: packedBlockRawLineIndex(manifest, index) + 1, points };
  }
  return null;
}

export type RecoveryWorkBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Work-coordinate extent of every burn at or after `fromLine`: what a
 * recovery from that line would still engrave. Null when nothing burns. */
export function remainingRecoveryWorkBounds(
  route: RecoveryPreviewRoute,
  fromLine: number,
): RecoveryWorkBounds | null {
  const manifest = route.manifest;
  const data = manifest.pointData;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const count = packedBlockCount(manifest);
  for (let block = 0; block < count; block += 1) {
    if (packedBlockKind(manifest, block) !== 'process') continue;
    if (packedBlockRawLineIndex(manifest, block) + 1 < fromLine) continue;
    const start = packedBlockPointOffset(manifest, block) * PACKED_POINT_WIDTH;
    const end = start + packedBlockPointCount(manifest, block) * PACKED_POINT_WIDTH;
    for (let at = start; at < end; at += PACKED_POINT_WIDTH) {
      includeWorkPoint(bounds, data[at] ?? Number.NaN, data[at + 1] ?? Number.NaN);
    }
  }
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) ? bounds : null;
}

function includeWorkPoint(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number,
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

export function acknowledgedRecoveryMovement(
  route: RecoveryPreviewRoute,
  ackedLines: number,
): number {
  const manifest = route.manifest;
  const count = packedBlockCount(manifest);
  let previous = 1;
  for (let index = 0; index < count; index += 1) {
    if (packedBlockKind(manifest, index) !== 'process') continue;
    previous = packedBlockRawLineIndex(manifest, index) + 1;
    if (packedBlockSendableLineIndex(manifest, index) >= ackedLines) return previous;
  }
  return previous;
}

export function zoomRecoveryPreview(
  view: RecoveryPreviewView,
  fit: RecoveryPreviewView,
  factor: number,
  anchor: Vec2 = { x: 0.5, y: 0.5 },
): RecoveryPreviewView {
  const width = Math.min(fit.width * 2, Math.max(fit.width / 1_024, view.width * factor));
  const height = width / 2;
  return {
    x: view.x + (view.width - width) * anchor.x,
    y: view.y + (view.height - height) * anchor.y,
    width,
    height,
  };
}

function walkProcessSegments(
  route: RecoveryPreviewRoute,
  visit: SegmentVisitor,
  view: RecoveryPreviewView,
): void {
  const index = recoveryPreviewIndex(route);
  const manifest = route.manifest;
  const count = packedBlockCount(manifest);
  for (let chunk = 0; chunk < index.bounds.length / 4; chunk += 1) {
    if (!previewChunkVisible(index.bounds, chunk, view)) continue;
    const limit = Math.min(count, (chunk + 1) * BLOCKS_PER_PREVIEW_CHUNK);
    for (let at = chunk * BLOCKS_PER_PREVIEW_CHUNK; at < limit; at += 1) {
      if (packedBlockKind(manifest, at) === 'process')
        visitBlockSegments(manifest, at, index, visit);
    }
  }
}

function visitBlockSegments(
  manifest: PackedMotionManifest,
  block: number,
  mapping: RecoveryPreviewIndex,
  visit: SegmentVisitor,
): void {
  const data = manifest.pointData;
  const start = packedBlockPointOffset(manifest, block) * PACKED_POINT_WIDTH;
  const end = start + packedBlockPointCount(manifest, block) * PACKED_POINT_WIDTH;
  for (let at = start + PACKED_POINT_WIDTH; at < end; at += PACKED_POINT_WIDTH) {
    visit(
      (data[at - PACKED_POINT_WIDTH] ?? 0) * mapping.scaleX + mapping.offset.x,
      (data[at - PACKED_POINT_WIDTH + 1] ?? 0) * mapping.scaleY + mapping.offset.y,
      (data[at] ?? 0) * mapping.scaleX + mapping.offset.x,
      (data[at + 1] ?? 0) * mapping.scaleY + mapping.offset.y,
      block,
    );
  }
}

function previewChunkVisible(
  bounds: Float64Array,
  chunk: number,
  view: RecoveryPreviewView,
): boolean {
  const at = chunk * 4;
  return (
    (bounds[at] ?? Infinity) <= view.x + view.width &&
    (bounds[at + 1] ?? Infinity) <= view.y + view.height &&
    (bounds[at + 2] ?? -Infinity) >= view.x &&
    (bounds[at + 3] ?? -Infinity) >= view.y
  );
}

/** One compact box per 256 source blocks. Zoomed raster views and clicks skip
 * offscreen rows without storing another copy of their endpoints. */
function recoveryPreviewIndex(route: RecoveryPreviewRoute): RecoveryPreviewIndex {
  const cached = previewIndexes.get(route);
  if (cached !== undefined) return cached;
  const offset = mapControllerPointToScene({ x: 0, y: 0, z: 0 }, route);
  const { scaleX, scaleY } = originMirrors(route.device.origin);
  const manifest = route.manifest;
  const count = packedBlockCount(manifest);
  const bounds = emptyChunkBounds(Math.ceil(count / BLOCKS_PER_PREVIEW_CHUNK));
  const data = manifest.pointData;
  for (let block = 0; block < count; block += 1) {
    if (packedBlockKind(manifest, block) !== 'process') continue;
    const at = Math.floor(block / BLOCKS_PER_PREVIEW_CHUNK) * 4;
    const start = packedBlockPointOffset(manifest, block) * PACKED_POINT_WIDTH;
    const end = start + packedBlockPointCount(manifest, block) * PACKED_POINT_WIDTH;
    for (let point = start; point < end; point += PACKED_POINT_WIDTH) {
      includeChunkPoint(
        bounds,
        at,
        (data[point] ?? 0) * scaleX + offset.x,
        (data[point + 1] ?? 0) * scaleY + offset.y,
      );
    }
  }
  const result = { bounds, offset, scaleX, scaleY };
  previewIndexes.set(route, result);
  return result;
}

/** Origin transforms are axis mirrors plus translation. Derive the signs
 * directly so subtracting two large translated coordinates cannot erase a
 * unit vector. */
function originMirrors(origin: RecoveryPreviewRoute['device']['origin']): {
  readonly scaleX: number;
  readonly scaleY: number;
} {
  return {
    scaleX: origin.endsWith('right') ? -1 : 1,
    scaleY: origin.startsWith('front') || origin === 'center' ? -1 : 1,
  };
}

function emptyChunkBounds(chunks: number): Float64Array {
  const bounds = new Float64Array(chunks * 4);
  for (let at = 0; at < bounds.length; at += 4) {
    bounds[at] = Infinity;
    bounds[at + 1] = Infinity;
    bounds[at + 2] = -Infinity;
    bounds[at + 3] = -Infinity;
  }
  return bounds;
}

function includeChunkPoint(bounds: Float64Array, at: number, x: number, y: number): void {
  bounds[at] = Math.min(bounds[at] ?? Infinity, x);
  bounds[at + 1] = Math.min(bounds[at + 1] ?? Infinity, y);
  bounds[at + 2] = Math.max(bounds[at + 2] ?? -Infinity, x);
  bounds[at + 3] = Math.max(bounds[at + 3] ?? -Infinity, y);
}

function intersectsView(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  view: RecoveryPreviewView,
): boolean {
  return (
    Math.max(x1, x2) >= view.x &&
    Math.min(x1, x2) <= view.x + view.width &&
    Math.max(y1, y2) >= view.y &&
    Math.min(y1, y2) <= view.y + view.height
  );
}

function segmentDistanceSquared(
  point: Vec2,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / length));
  return (point.x - x1 - t * dx) ** 2 + (point.y - y1 - t * dy) ** 2;
}
