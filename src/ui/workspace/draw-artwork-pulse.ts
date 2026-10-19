// Paints the operation colour pulse (ADR-620, ADR-632 Amendment 1) on its own
// pointer-transparent canvas above the workspace, so a pulse never redraws the
// scene. Each piece's bitmaps (pulse-piece-bitmap.ts) are rendered once per
// hover; a frame only blits them at an alpha, with no blur. While the view
// zooms or pans they are drawn scaled, and re-render once it has settled.
// Missing bitmaps render within a per-frame budget, the most visible first, so
// pointing at one of many same-settings pieces never stalls a frame.

import {
  operationIdsForObject,
  sceneLayerVisibility,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { getCanvasColorScheme } from '../theme/canvas-color-scheme';
import { canvasVectorDisplayColor } from '../theme/canvas-vector-color';
import type { PulsePieceFrame } from './artwork-pulse';
import { createDisplayPolylineCache } from './display-polylines';
import type { ObjectDisplayMode } from './object-display';
import {
  pieceBitmapPixels,
  releasePieceBitmap,
  renderPieceBitmap,
  type PieceBitmap,
  type PlacedBitmap,
} from './pulse-piece-bitmap';
import type { ViewTransform } from './view-transform';

/** Recent pieces kept after their pulse ends, so pointing again is instant. */
const RETAINED_PIECES = 8;
/** About 64 MB of RGBA pixels; live pieces are kept even above this budget. */
const RETAINED_PIXELS = 16_000_000;
/** Rendering stops for the frame after this long; at least one piece always renders. */
const RENDER_BUDGET_MS = 6;
/** Bitmaps drawn scaled during a zoom or pan re-render once the view is still this long. */
const VIEW_SETTLE_MS = 140;

type Identity = {
  readonly object: SceneObject;
  /** The operation whose artwork is drawn… */
  readonly layer: Layer;
  /** …in this operation's colour (the one the pointer is on). */
  readonly colorLayer: Layer;
  /** Other bound operations can change the path's visible fill/stroke style. */
  readonly lookup: ReadonlyMap<string, Layer>;
  readonly displayMode: ObjectDisplayMode;
  readonly colorScheme: string;
};

type CacheEntry = Identity & {
  /** The view and overlay size the bitmap was rendered for. */
  readonly viewKey: string;
  readonly bitmap: PieceBitmap | null;
};

/** One frame's shared inputs and what it collects while drawing. */
type FrameWork = {
  readonly layers: ReadonlyArray<Layer>;
  readonly displayMode: ObjectDisplayMode;
  readonly colorScheme: string;
  readonly live: Set<string>;
  readonly jobs: RenderJob[];
};

type RenderJob = {
  readonly key: string;
  readonly identity: Identity;
  readonly piece: PulsePieceFrame;
  /** The right artwork rendered for another view: drawn scaled until it re-renders. */
  readonly stale: PieceBitmap | null;
};

export class ArtworkPulsePainter {
  private readonly entries = new Map<string, CacheEntry>();
  private layers: ReadonlyArray<Layer> | undefined;
  private objects: ReadonlyArray<SceneObject> | undefined;
  private layerById = new Map<string, Layer>();
  private objectById = new Map<string, SceneObject>();
  private lookup: ReadonlyMap<string, Layer> = new Map();
  private readonly displayCache = createDisplayPolylineCache();
  private readonly objectOperations = new WeakMap<
    SceneObject,
    { readonly layers: ReadonlyArray<Layer>; readonly ids: ReadonlyArray<string> }
  >();
  private readonly renderBudgetMs: number;
  private viewKey = '';
  private viewChangedAt = Number.NEGATIVE_INFINITY;

  constructor(options: { readonly renderBudgetMs?: number } = {}) {
    this.renderBudgetMs = options.renderBudgetMs ?? RENDER_BUDGET_MS;
  }

  /**
   * Paints one frame. Returns true while a piece still waits for its bitmap,
   * or for the view to settle, so the caller schedules another frame.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    project: Project,
    view: ViewTransform,
    pieces: ReadonlyArray<PulsePieceFrame>,
    displayMode: ObjectDisplayMode = 'design',
    now: number = performance.now(),
  ): boolean {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    this.indexScene(project);
    const viewKey = `${view.scale}|${view.offsetX}|${view.offsetY}|${width}x${height}`;
    if (viewKey !== this.viewKey) {
      this.viewKey = viewKey;
      this.viewChangedAt = now;
    }
    const frame: FrameWork = {
      layers: project.scene.layers,
      displayMode,
      colorScheme: getCanvasColorScheme(),
      live: new Set<string>(),
      jobs: [],
    };
    for (const piece of pieces) this.drawCurrent(ctx, piece, view, frame);
    const pending = this.render(ctx, frame.jobs, view, now - this.viewChangedAt >= VIEW_SETTLE_MS);
    this.retain(frame.live);
    return pending;
  }

  /** Draws the piece's bitmaps that are current for this view; queues the rest to render. */
  private drawCurrent(
    ctx: CanvasRenderingContext2D,
    piece: PulsePieceFrame,
    view: ViewTransform,
    frame: FrameWork,
  ): void {
    const object = this.objectById.get(piece.objectId);
    if (object === undefined) return;
    // Only the piece's own operations: a group of N same-settings imports
    // carries N operations, and pairing every piece with every one of them
    // would render N² empty bitmaps.
    for (const operationId of this.operationsOf(object, frame.layers)) {
      const sourceId = piece.colorSources.get(operationId);
      const layer = this.layerById.get(operationId);
      if (sourceId === undefined || layer === undefined || !layer.visible) continue;
      const key = `${object.id}\u0000${operationId}`;
      frame.live.add(key);
      const identity: Identity = {
        object,
        layer,
        colorLayer: this.layerById.get(sourceId) ?? layer,
        lookup: this.lookup,
        displayMode: frame.displayMode,
        colorScheme: frame.colorScheme,
      };
      const cached = this.touch(key);
      const current = cached !== undefined && sameIdentity(cached, identity);
      if (current && cached.viewKey === this.viewKey) {
        if (cached.bitmap !== null) drawPiece(ctx, cached.bitmap, piece, view);
      } else {
        frame.jobs.push({ key, identity, piece, stale: current ? cached.bitmap : null });
      }
    }
  }

  /**
   * Renders what is missing, the most visible piece first, until the frame's
   * budget runs out. A piece that only needs the current view keeps drawing
   * its scaled bitmap until the view has settled.
   */
  private render(
    ctx: CanvasRenderingContext2D,
    jobs: ReadonlyArray<RenderJob>,
    view: ViewTransform,
    settled: boolean,
  ): boolean {
    const ordered = [...jobs].sort(
      (a, b) =>
        Number(a.stale !== null) - Number(b.stale !== null) ||
        visibility(b.piece) - visibility(a.piece),
    );
    const deadline = performance.now() + this.renderBudgetMs;
    let rendered = 0;
    let pending = false;
    for (const job of ordered) {
      const inBudget = rendered === 0 || performance.now() < deadline;
      if (!inBudget || (job.stale !== null && !settled)) {
        pending = true;
        if (job.stale !== null) drawPiece(ctx, job.stale, job.piece, view);
        continue;
      }
      const { identity } = job;
      const bitmap = renderPieceBitmap({
        object: identity.object,
        layer: identity.layer,
        color: canvasVectorDisplayColor(identity.colorLayer.color),
        lookup: identity.lookup,
        view,
        canvas: ctx.canvas,
        displayCache: this.displayCache,
        displayMode: identity.displayMode,
      });
      rendered += 1;
      const replaced = this.entries.get(job.key)?.bitmap;
      this.entries.set(job.key, { ...identity, viewKey: this.viewKey, bitmap });
      if (replaced !== bitmap) releasePieceBitmap(replaced);
      if (bitmap !== null) drawPiece(ctx, bitmap, job.piece, view);
    }
    return pending;
  }

  /** The cached entry, re-inserted so `retain` sees it as most recently used. */
  private touch(key: string): CacheEntry | undefined {
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, cached);
    }
    return cached;
  }

  /** Immutable scene arrays let animation frames reuse their scene-wide indexes. */
  private indexScene(project: Project): void {
    const { layers, objects } = project.scene;
    if (layers !== this.layers) {
      this.layers = layers;
      this.layerById = new Map(layers.map((layer) => [layer.id, layer]));
      this.lookup = sceneLayerVisibility.lookup(layers);
    }
    if (objects !== this.objects) {
      this.objects = objects;
      this.objectById = new Map(objects.map((object) => [object.id, object]));
    }
  }

  /** The operations an object's artwork uses, kept until the object or the operations change. */
  private operationsOf(object: SceneObject, layers: ReadonlyArray<Layer>): ReadonlyArray<string> {
    const cached = this.objectOperations.get(object);
    if (cached?.layers === layers) return cached.ids;
    const ids = operationIdsForObject(object, layers);
    this.objectOperations.set(object, { layers, ids });
    return ids;
  }

  /** Keep every live piece and the most recently used others, oldest out first. */
  private retain(live: ReadonlySet<string>): void {
    let spare = RETAINED_PIECES;
    let pixels = RETAINED_PIXELS;
    for (const key of live) pixels -= pieceBitmapPixels(this.entries.get(key)?.bitmap);
    for (const key of [...this.entries.keys()].reverse()) {
      if (live.has(key)) continue;
      const bitmap = this.entries.get(key)?.bitmap;
      const size = pieceBitmapPixels(bitmap);
      if (spare > 0 && size <= pixels) {
        spare -= 1;
        pixels -= size;
      } else {
        this.entries.delete(key);
        releasePieceBitmap(bitmap);
      }
    }
  }
}

function sameIdentity(cached: CacheEntry, identity: Identity): boolean {
  return (
    cached.object === identity.object &&
    cached.layer === identity.layer &&
    cached.colorLayer === identity.colorLayer &&
    cached.lookup === identity.lookup &&
    cached.displayMode === identity.displayMode &&
    cached.colorScheme === identity.colorScheme
  );
}

/** How much of a piece shows this frame: the hovered piece, already rising, renders first. */
function visibility(piece: PulsePieceFrame): number {
  return piece.strength + piece.glowAlpha + piece.edgeAlpha;
}

/** The bloom, the resting edge and the colour, each a plain blit at its alpha. */
function drawPiece(
  ctx: CanvasRenderingContext2D,
  bitmap: PieceBitmap,
  piece: PulsePieceFrame,
  view: ViewTransform,
): void {
  blit(ctx, bitmap, bitmap.bloom, piece.glowAlpha, view);
  blit(ctx, bitmap, bitmap.edge, piece.edgeAlpha, view);
  blit(ctx, bitmap, bitmap.flood, piece.strength, view);
  ctx.globalAlpha = 1;
}

/** Draws a bitmap where it belongs in `view`, scaled when it was rendered for another view. */
function blit(
  ctx: CanvasRenderingContext2D,
  bitmap: PieceBitmap,
  placed: PlacedBitmap,
  alpha: number,
  view: ViewTransform,
): void {
  if (!(alpha > 0)) return;
  ctx.globalAlpha = Math.min(1, alpha);
  const from = bitmap.view;
  if (from.scale === view.scale && from.offsetX === view.offsetX && from.offsetY === view.offsetY) {
    ctx.drawImage(placed.canvas, placed.left, placed.top);
    return;
  }
  const k = view.scale / from.scale;
  ctx.drawImage(
    placed.canvas,
    view.offsetX + (placed.left - from.offsetX) * k,
    view.offsetY + (placed.top - from.offsetY) * k,
    placed.canvas.width * k,
    placed.canvas.height * k,
  );
}
