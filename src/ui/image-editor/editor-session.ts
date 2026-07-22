// Image Studio session model + operations (ADR-242, flows F-L1/F-L2).
//
// A session owns the mutable RGBA working document for one raster-image
// object. Ops mutate the document in place through the core *InPlace contract
// and bump `revision` so React consumers redraw; the editor-local tile
// history makes every committed op reversible. Sessions survive editor close
// (resumable, no confirmation surfaces — CLAUDE.md #7) and live only in
// memory (F-L4 edge).

import {
  captureRect,
  cloneRgbaBuffer,
  createEditHistory,
  pushHistoryEntry,
  redoInPlace,
  undoInPlace,
  type BrushParams,
  type EditHistory,
  type PaintColor,
  type PaintPoint,
  type PixelRect,
  type RgbaBuffer,
} from '../../core/image-edit';
import { paintStrokeInPlace, snapLineEnd45, strokeDirtyRect } from '../../core/image-edit';
import { layerFromBuffer, type EditorLayer } from '../../core/image-layers';
import {
  blitFloatingInPlace,
  borderMask,
  contractMask,
  expandMask,
  extractFloatingRegion,
  featherMask,
  fillMaskedInPlace,
  maskBounds,
  smoothMask,
  type SelectionMask,
} from '../../core/image-select';

export const BACKGROUND_LAYER_ID = 'background';

export type SelectionModifyKind = 'expand' | 'contract' | 'border' | 'smooth' | 'feather';

/** Select ▸ Modify (Photoshop): reshape the current selection by a px amount. */
export function modifySelectionMask(
  selection: SelectionMask,
  kind: SelectionModifyKind,
  radiusPx: number,
): SelectionMask {
  switch (kind) {
    case 'expand':
      return expandMask(selection, radiusPx);
    case 'contract':
      return contractMask(selection, radiusPx);
    case 'border':
      return borderMask(selection, radiusPx);
    case 'smooth':
      return smoothMask(selection, radiusPx);
    case 'feather':
      return featherMask(selection, radiusPx);
  }
}

import type { Bounds } from '../../core/scene';

export const WHITE: PaintColor = { r: 255, g: 255, b: 255 };
export const BLACK: PaintColor = { r: 0, g: 0, b: 0 };

export type EditorTool =
  | { readonly kind: 'brush' }
  | { readonly kind: 'pencil' }
  | { readonly kind: 'eraser' }
  | { readonly kind: 'line' }
  // Rect/ellipse share the marquee slot (Photoshop's M flyout; M cycles).
  | { readonly kind: 'marquee'; readonly shape: 'rect' | 'ellipse' }
  | { readonly kind: 'lasso' }
  | { readonly kind: 'wand' }
  // Bucket/gradient share the fill slot (G cycles, like M for marquee).
  | { readonly kind: 'bucket' }
  | { readonly kind: 'gradient'; readonly shape: 'linear' | 'radial' }
  | { readonly kind: 'crop' }
  | { readonly kind: 'move' };

export type BrushSettings = {
  readonly diameterPx: number;
  /** 0..1 soft-tip hardness. */
  readonly hardness: number;
  /** 0..1 stroke opacity. */
  readonly opacity: number;
};

export type EditorSession = {
  readonly objectId: string;
  readonly sourceName: string;
  /**
   * Mutable working document — mutated in place by session ops. ADR-245
   * invariant: this IS the active layer's buffer (pointer-shared), so every
   * op edits the active layer without knowing layers exist.
   */
  readonly doc: RgbaBuffer;
  /** Bottom-up layer stack; index 0 is the Background (ADR-245). */
  readonly layers: readonly EditorLayer[];
  readonly activeLayerId: string;
  /** As-opened pixels, for the explicit Revert action (F-L4). */
  readonly base: RgbaBuffer;
  /** Where the doc sits inside the as-opened image (crop accumulates). */
  readonly cropOffset: { readonly x: number; readonly y: number };
  /** The object's mm bounds at open — Apply maps crops through these. */
  readonly sourceBounds: Bounds;
  readonly history: EditHistory;
  readonly selection: SelectionMask | null;
  /** Bumped on every visible document/selection change to trigger redraws. */
  readonly revision: number;
  /** True once any op landed after open or the last Apply. */
  readonly dirtySinceApply: boolean;
  /**
   * Pixels changed by the op that produced this revision: a rect for the
   * hot ops (stroke/fill/move/adjust), EMPTY_DIRTY_RECT for selection-only
   * changes, null = everything (layer/structure ops, crop, undo). Drives
   * the dirty-window composite cache (V2 plan A1).
   */
  readonly lastDirtyRect: PixelRect | null;
};

/** Zero-area marker: the revision changed nothing the composite can see. */
export const EMPTY_DIRTY_RECT: PixelRect = { x: 0, y: 0, width: 0, height: 0 };

export function createSession(
  objectId: string,
  sourceName: string,
  doc: RgbaBuffer,
  sourceBounds: Bounds,
): EditorSession {
  return {
    objectId,
    sourceName,
    doc,
    layers: [layerFromBuffer(BACKGROUND_LAYER_ID, 'Background', doc)],
    activeLayerId: BACKGROUND_LAYER_ID,
    base: cloneRgbaBuffer(doc),
    cropOffset: { x: 0, y: 0 },
    sourceBounds,
    history: createEditHistory(),
    selection: null,
    revision: 0,
    dirtySinceApply: false,
    lastDirtyRect: null,
  };
}

/** Explicit Revert: back to the as-opened pixels (un-crops, un-layers too). */
export function revertSession(session: EditorSession): EditorSession {
  const doc = cloneRgbaBuffer(session.base);
  return {
    ...session,
    doc,
    layers: [layerFromBuffer(BACKGROUND_LAYER_ID, 'Background', doc)],
    activeLayerId: BACKGROUND_LAYER_ID,
    cropOffset: { x: 0, y: 0 },
    history: createEditHistory(),
    selection: null,
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: null,
  };
}

/**
 * The mm bounds Apply should write for a cropped document, mapped through
 * the accumulated offset at the same DPI (the shipped cropLocalBounds
 * convention) — null when the document is uncropped.
 */
export function appliedBounds(session: EditorSession): Bounds | null {
  const { sourceBounds } = session;
  const uncropped =
    session.cropOffset.x === 0 &&
    session.cropOffset.y === 0 &&
    session.doc.width === session.base.width &&
    session.doc.height === session.base.height;
  if (uncropped) return null;
  const widthMm = sourceBounds.maxX - sourceBounds.minX;
  const heightMm = sourceBounds.maxY - sourceBounds.minY;
  const sx = widthMm / session.base.width;
  const sy = heightMm / session.base.height;
  return {
    minX: sourceBounds.minX + session.cropOffset.x * sx,
    minY: sourceBounds.minY + session.cropOffset.y * sy,
    maxX: sourceBounds.minX + (session.cropOffset.x + session.doc.width) * sx,
    maxY: sourceBounds.minY + (session.cropOffset.y + session.doc.height) * sy,
  };
}

/**
 * Crop the working document to the rect. Tile history cannot span a resize,
 * so the editor history clears (surfaced in the status row); Revert still
 * restores the full as-opened image, and Apply maps the mm bounds through
 * the accumulated offset so physical scale stays honest.
 */
export function commitCrop(session: EditorSession, rect: PixelRect): EditorSession {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(session.doc.width - x, Math.round(rect.width)));
  const height = Math.max(1, Math.min(session.doc.height - y, Math.round(rect.height)));
  if (width <= 0 || height <= 0) return session;
  // Every layer crops identically so dimensions stay uniform (ADR-245); the
  // active layer's cropped buffer becomes the new doc pointer.
  const layers = session.layers.map((layer) => ({
    ...layer,
    buffer: cropBuffer(layer.buffer, x, y, width, height),
  }));
  const active = layers.find((layer) => layer.id === session.activeLayerId) ?? layers[0];
  if (active === undefined) return session;
  return {
    ...session,
    doc: active.buffer,
    layers,
    activeLayerId: active.id,
    cropOffset: { x: session.cropOffset.x + x, y: session.cropOffset.y + y },
    history: createEditHistory(),
    selection: null,
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: null,
  };
}

function cropBuffer(
  source: RgbaBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
): RgbaBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const src = ((y + row) * source.width + x) * 4;
    data.set(source.data.subarray(src, src + width * 4), row * width * 4);
  }
  return { width, height, data };
}

/** BrushParams for a paint tool (pencil = pixel tip, others = soft tip). */
export function brushFor(tool: EditorTool, settings: BrushSettings): BrushParams {
  const tip =
    tool.kind === 'pencil'
      ? ({ kind: 'pixel' } as const)
      : ({ kind: 'soft', hardness: settings.hardness } as const);
  return { diameterPx: settings.diameterPx, opacity: settings.opacity, tip };
}

/** History capture tagged with the active layer (V2 plan A2). */
export function captureScoped(
  session: EditorSession,
  rect: PixelRect,
  label: string,
): ReturnType<typeof captureRect> {
  return captureRect(session.doc, rect, label, undefined, session.activeLayerId);
}

function committed(
  session: EditorSession,
  history: EditHistory,
  dirtyRect: PixelRect,
): EditorSession {
  return {
    ...session,
    history,
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: dirtyRect,
  };
}

/** Brush / pencil / eraser stroke (eraser paints white). */
export function commitStroke(
  session: EditorSession,
  tool: EditorTool,
  settings: BrushSettings,
  color: PaintColor,
  points: readonly PaintPoint[],
  label: string,
): EditorSession {
  const stroke = {
    points,
    brush: brushFor(tool, settings),
    color: tool.kind === 'eraser' ? WHITE : color,
  };
  const rect = strokeDirtyRect(stroke, session.doc);
  if (rect.width === 0 || rect.height === 0) return session;
  const entry = captureScoped(session, rect, label);
  // Photoshop: an active selection clamps every stroke.
  paintStrokeInPlace(session.doc, stroke, session.selection ?? undefined);
  return committed(session, pushHistoryEntry(session.history, entry), rect);
}

/** Line tool: a two-point stroke; Shift constrains to 45°. */
export function commitLine(
  session: EditorSession,
  settings: BrushSettings,
  color: PaintColor,
  from: PaintPoint,
  to: PaintPoint,
  constrain45: boolean,
): EditorSession {
  const end = constrain45 ? snapLineEnd45(from, to) : to;
  return commitStroke(session, { kind: 'line' }, settings, color, [from, end], 'Line');
}

export function withSelection(
  session: EditorSession,
  selection: SelectionMask | null,
): EditorSession {
  // Selection changes never move pixels — the composite cache stays valid.
  return { ...session, selection, revision: session.revision + 1, lastDirtyRect: EMPTY_DIRTY_RECT };
}

/** Move the selection OUTLINE only (selection-tool drag / arrow nudge). */
export function nudgeOutline(session: EditorSession, dx: number, dy: number): EditorSession {
  if (session.selection === null) return session;
  return withSelection(session, shiftMask(session.selection, Math.round(dx), Math.round(dy)));
}

/** Delete (fill white) or Fill (fill colour) the selected area. */
export function commitFillSelection(
  session: EditorSession,
  color: PaintColor,
  label: string,
): EditorSession {
  if (session.selection === null) return session;
  const bounds = maskBounds(session.selection);
  if (bounds === null) return session;
  const entry = captureScoped(session, bounds, label);
  fillMaskedInPlace(session.doc, session.selection, color);
  return committed(session, pushHistoryEntry(session.history, entry), bounds);
}

/** Move the selected pixels by (dx, dy): extract → white-fill → blit. */
export function commitMoveSelection(session: EditorSession, dx: number, dy: number): EditorSession {
  if (session.selection === null) return session;
  const floating = extractFloatingRegion(session.doc, session.selection);
  if (floating === null) return session;
  const target: PixelRect = {
    x: floating.rect.x + Math.round(dx),
    y: floating.rect.y + Math.round(dy),
    width: floating.rect.width,
    height: floating.rect.height,
  };
  const touched = unionRects(floating.rect, target);
  const entry = captureScoped(session, touched, 'Move selection');
  fillMaskedInPlace(session.doc, session.selection, WHITE);
  blitFloatingInPlace(session.doc, floating, dx, dy);
  // The selection travels with its contents; a shifted mask keeps later ops
  // (delete/fill/second move) anchored on the moved pixels.
  return {
    ...committed(session, pushHistoryEntry(session.history, entry), touched),
    selection: shiftMask(session.selection, Math.round(dx), Math.round(dy)),
  };
}

export function undoSession(session: EditorSession): EditorSession {
  const result = undoInPlace(session.history, session.doc);
  if (result.applied === null) return session;
  return {
    ...session,
    history: result.history,
    revision: session.revision + 1,
    lastDirtyRect: null,
  };
}

export function redoSession(session: EditorSession): EditorSession {
  const result = redoInPlace(session.history, session.doc);
  if (result.applied === null) return session;
  return {
    ...session,
    history: result.history,
    revision: session.revision + 1,
    lastDirtyRect: null,
  };
}

function unionRects(a: PixelRect, b: PixelRect): PixelRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function shiftMask(mask: SelectionMask, dx: number, dy: number): SelectionMask {
  const alpha = new Uint8Array(mask.alpha.length);
  for (let y = 0; y < mask.height; y += 1) {
    const srcY = y - dy;
    if (srcY < 0 || srcY >= mask.height) continue;
    for (let x = 0; x < mask.width; x += 1) {
      const srcX = x - dx;
      if (srcX < 0 || srcX >= mask.width) continue;
      alpha[y * mask.width + x] = mask.alpha[srcY * mask.width + srcX] ?? 0;
    }
  }
  return { width: mask.width, height: mask.height, alpha };
}
