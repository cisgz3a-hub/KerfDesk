// Pool raster previews and bitmaps (fill-pool-raster.ts, ADR-683 Amendment 3).
// While a large pool changes by a few members, it is shown from a finished
// raster: its fill composited "xor" with the changed members' old and new
// contours (exactly how even-odd parity changes), and its outline with the old
// ones erased and the new ones stroked (approximate where outlines cross).

import type { Polyline } from '../../core/scene';
import {
  fillClosedPolylinesBatched,
  strokePolylinesBatched,
  type Placed,
} from './draw-vector-strokes';
import type { FillPool } from './fill-pools';
import type { VectorSceneObject } from './object-display';
import type { ViewTransform } from './view-transform';

/** Changed segments past which a drag is not previewed but painted exactly. */
export const PREVIEW_MAX_SEGMENTS = 20_000;
export const MAX_RASTER_PIXELS = 4_000_000;
export const MAX_RASTER_SIDE_PX = 8192;
export const WORLD: Placed = {
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, mirrorX: false, mirrorY: false },
};

export type Layers = { readonly fill: HTMLCanvasElement; readonly stroke: HTMLCanvasElement };
export type RasterMember = {
  readonly object: VectorSceneObject;
  readonly contours: ReadonlyArray<Polyline>;
};
/** Where a bitmap's pixel (0, 0) lies in world millimetres, and its pixels per millimetre. */
export type Frame = { readonly worldX0: number; readonly worldY0: number; readonly scale: number };
/** What a preview reads of a raster: its frame, size, pool, members and layers. */
export type PreviewSource = Frame & {
  readonly pool: FillPool;
  readonly members: ReadonlyMap<string, RasterMember>;
  readonly width: number;
  readonly height: number;
  readonly layers: Layers | null;
};

export const previewWork = { previews: 0 };
let scratch: Layers | null = null;

export function resetPreviewScratchForTests(): void {
  scratch = null;
  previewWork.previews = 0;
}

export function paintView(frame: Frame): ViewTransform {
  return {
    scale: frame.scale,
    offsetX: -frame.worldX0 * frame.scale,
    offsetY: -frame.worldY0 * frame.scale,
  };
}

export type Diff = {
  readonly removed: ReadonlyArray<Polyline>;
  readonly added: ReadonlyArray<Polyline>;
  readonly segments: number;
};

export function difference(base: PreviewSource, target: PreviewSource): Diff | null {
  const removed: Polyline[] = [];
  const added: Polyline[] = [];
  let segments = 0;
  const take = (into: Polyline[], contours: ReadonlyArray<Polyline>): boolean => {
    for (const contour of contours) {
      into.push(contour);
      segments += Math.max(0, contour.points.length - 1);
    }
    return segments <= PREVIEW_MAX_SEGMENTS;
  };
  for (const [id, member] of base.members) {
    if (target.members.get(id)?.object !== member.object && !take(removed, member.contours))
      return null;
  }
  for (const [id, member] of target.members) {
    if (base.members.get(id)?.object !== member.object && !take(added, member.contours))
      return null;
  }
  return { removed, added, segments };
}

// The target shown from a finished base: base fill xor the changed contours,
// base outline less the old ones plus the new ones, on bitmaps aligned to the
// base's pixels and grown to hold the target.
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  base: { readonly raster: PreviewSource; readonly diff: Diff },
  target: PreviewSource,
  view: ViewTransform,
): boolean {
  const { raster, diff } = base;
  const layers = raster.layers as Layers;
  if (diff.removed.length === 0 && diff.added.length === 0) {
    // The same pool at another scale: the zoom placeholder.
    blitLayers(ctx, layers, raster, view);
    return true;
  }
  const s = raster.scale;
  const dx = Math.max(0, Math.ceil((raster.worldX0 - target.worldX0) * s));
  const dy = Math.max(0, Math.ceil((raster.worldY0 - target.worldY0) * s));
  const frame: Frame = {
    worldX0: raster.worldX0 - dx / s,
    worldY0: raster.worldY0 - dy / s,
    scale: s,
  };
  const right = Math.max(
    raster.worldX0 + raster.width / s,
    target.worldX0 + target.width / target.scale,
  );
  const bottom = Math.max(
    raster.worldY0 + raster.height / s,
    target.worldY0 + target.height / target.scale,
  );
  const width = Math.ceil((right - frame.worldX0) * s);
  const height = Math.ceil((bottom - frame.worldY0) * s);
  if (
    width * height > MAX_RASTER_PIXELS ||
    width > MAX_RASTER_SIDE_PX ||
    height > MAX_RASTER_SIDE_PX
  ) {
    return false;
  }
  const layersOut = scratchLayers(width, height);
  if (layersOut === null) return false;
  const pv = paintView(frame);
  const fill = layersOut.fill.getContext('2d') as CanvasRenderingContext2D;
  fill.drawImage(layers.fill, dx, dy);
  fill.globalCompositeOperation = 'xor';
  fill.fillStyle = target.pool.color;
  fillClosedPolylinesBatched(fill, WORLD, [...diff.removed, ...diff.added], pv, 'evenodd');
  fill.globalCompositeOperation = 'source-over';
  const stroke = layersOut.stroke.getContext('2d') as CanvasRenderingContext2D;
  stroke.drawImage(layers.stroke, dx, dy);
  if (diff.removed.length > 0) {
    stroke.globalCompositeOperation = 'destination-out';
    stroke.lineWidth = raster.pool.widthPx + 2;
    strokePolylinesBatched(stroke, WORLD, diff.removed, pv);
    stroke.globalCompositeOperation = 'source-over';
  }
  stroke.strokeStyle = target.pool.color;
  stroke.lineWidth = target.pool.widthPx;
  if (diff.added.length > 0) strokePolylinesBatched(stroke, WORLD, diff.added, pv);
  previewWork.previews += 1;
  blitLayers(ctx, layersOut, frame, view);
  return true;
}

function scratchLayers(width: number, height: number): Layers | null {
  if (scratch === null) {
    const fill = newCanvas(width, height);
    const stroke = newCanvas(width, height);
    if (fill === null || stroke === null) return null;
    scratch = { fill: fill.canvas, stroke: stroke.canvas };
  }
  for (const canvas of [scratch.fill, scratch.stroke]) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    } else {
      canvas.getContext('2d')?.clearRect(0, 0, width, height);
    }
  }
  return scratch;
}

export function newCanvas(
  width: number,
  height: number,
): { readonly canvas: HTMLCanvasElement } | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d') === null ? null : { canvas };
}

// Fill, then outline, each at the context's alpha, as a direct paint lays them.
// At the frame's own scale pixel (0, 0) goes to the nearest whole pixel; at
// another (a zoom in progress) both are scaled into place.
export function blitLayers(
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  frame: Frame,
  view: ViewTransform,
): void {
  const x = view.offsetX + frame.worldX0 * view.scale;
  const y = view.offsetY + frame.worldY0 * view.scale;
  const ratio = view.scale / frame.scale;
  for (const canvas of [layers.fill, layers.stroke]) {
    if (ratio === 1) ctx.drawImage(canvas, Math.round(x), Math.round(y));
    else ctx.drawImage(canvas, x, y, canvas.width * ratio, canvas.height * ratio);
  }
}
