import type { MotionBlock } from '../../core/job/motion-manifest';
import type { Vec2 } from '../../core/scene';
import { mapControllerPointToScene, type CanvasMotionPlan } from '../state/canvas-motion-plan';

export type RecoveryPreviewView = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export const RECOVERY_PREVIEW_SEGMENT_LIMIT = 2_000;
const BLOCKS_PER_PREVIEW_CHUNK = 256;

type RecoveryPreviewIndex = {
  readonly bounds: Float64Array;
  readonly offset: Vec2;
  readonly scaleX: number;
  readonly scaleY: number;
};

const previewIndexes = new WeakMap<CanvasMotionPlan, RecoveryPreviewIndex>();

/** Borrow the archived manifest. Never clone its potentially millions of points. */
export function recoveryPreviewBounds(plan: CanvasMotionPlan): RecoveryPreviewView | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const { bounds } = recoveryPreviewIndex(plan);
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
  plan: CanvasMotionPlan,
  view: RecoveryPreviewView,
): { readonly path: string; readonly sampled: boolean; readonly shown: number } {
  const segments: PreviewSegment[] = [];
  let visible = 0;
  walkProcessSegments(
    plan,
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
  plan: CanvasMotionPlan,
  point: Vec2,
  toleranceMm: number,
  preferredRawLine: number,
): number | null {
  let distance = toleranceMm * toleranceMm;
  let rawLine: number | null = null;
  walkProcessSegments(
    plan,
    (x1, y1, x2, y2, block) => {
      const candidate = segmentDistanceSquared(point, x1, y1, x2, y2);
      const line = block.rawLineIndex + 1;
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

export function firstRecoveryMovement(plan: CanvasMotionPlan, rawLine: number): MotionBlock | null {
  const blocks = plan.manifest.blocks;
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((blocks[middle]?.rawLineIndex ?? Infinity) < rawLine - 1) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block?.kind === 'process') return block;
  }
  return null;
}

export function acknowledgedRecoveryMovement(plan: CanvasMotionPlan, ackedLines: number): number {
  let previous = 1;
  for (const block of plan.manifest.blocks) {
    if (block.kind !== 'process') continue;
    previous = block.rawLineIndex + 1;
    if (block.sendableLineIndex >= ackedLines) return previous;
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
  plan: CanvasMotionPlan,
  visit: (x1: number, y1: number, x2: number, y2: number, block: MotionBlock) => void,
  view: RecoveryPreviewView,
): void {
  const index = recoveryPreviewIndex(plan);
  const blocks = plan.manifest.blocks;
  for (let chunk = 0; chunk < index.bounds.length / 4; chunk += 1) {
    if (!previewChunkVisible(index.bounds, chunk, view)) continue;
    const limit = Math.min(blocks.length, (chunk + 1) * BLOCKS_PER_PREVIEW_CHUNK);
    for (let at = chunk * BLOCKS_PER_PREVIEW_CHUNK; at < limit; at += 1) {
      const block = blocks[at];
      if (block?.kind === 'process') visitBlockSegments(block, index, visit);
    }
  }
}

function visitBlockSegments(
  block: MotionBlock,
  mapping: RecoveryPreviewIndex,
  visit: (x1: number, y1: number, x2: number, y2: number, block: MotionBlock) => void,
): void {
  for (let index = 1; index < block.points.length; index += 1) {
    const from = block.points[index - 1];
    const to = block.points[index];
    if (from === undefined || to === undefined) continue;
    visit(
      from.x * mapping.scaleX + mapping.offset.x,
      from.y * mapping.scaleY + mapping.offset.y,
      to.x * mapping.scaleX + mapping.offset.x,
      to.y * mapping.scaleY + mapping.offset.y,
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
function recoveryPreviewIndex(plan: CanvasMotionPlan): RecoveryPreviewIndex {
  const cached = previewIndexes.get(plan);
  if (cached !== undefined) return cached;
  const offset = mapControllerPointToScene({ x: 0, y: 0, z: 0 }, plan);
  // Origin transforms are axis mirrors plus translation. Derive signs directly
  // so subtracting two large translated coordinates cannot erase a unit vector.
  const scaleX = plan.device.origin.endsWith('right') ? -1 : 1;
  const scaleY = plan.device.origin.startsWith('front') || plan.device.origin === 'center' ? -1 : 1;
  const blocks = plan.manifest.blocks;
  const bounds = new Float64Array(Math.ceil(blocks.length / BLOCKS_PER_PREVIEW_CHUNK) * 4);
  for (let at = 0; at < bounds.length; at += 4) {
    bounds[at] = Infinity;
    bounds[at + 1] = Infinity;
    bounds[at + 2] = -Infinity;
    bounds[at + 3] = -Infinity;
  }
  blocks.forEach((block, blockIndex) => {
    if (block.kind !== 'process') return;
    const at = Math.floor(blockIndex / BLOCKS_PER_PREVIEW_CHUNK) * 4;
    for (const point of block.points) {
      const x = point.x * scaleX + offset.x;
      const y = point.y * scaleY + offset.y;
      bounds[at] = Math.min(bounds[at] ?? Infinity, x);
      bounds[at + 1] = Math.min(bounds[at + 1] ?? Infinity, y);
      bounds[at + 2] = Math.max(bounds[at + 2] ?? -Infinity, x);
      bounds[at + 3] = Math.max(bounds[at + 3] ?? -Infinity, y);
    }
  });
  const result = { bounds, offset, scaleX, scaleY };
  previewIndexes.set(plan, result);
  return result;
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
