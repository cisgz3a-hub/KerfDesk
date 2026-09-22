// Cached bitmaps ("sprites") of dense vector objects (ADR-346).
//
// Every workspace repaint used to re-rasterize every display segment of every
// object. Canvas2D pays per segment on each stroke() or fill() — measured on
// an Iris Xe laptop: ~3 µs per 1.5 px stroke segment and ~0.9 µs per fill
// segment — so a dense trace cost hundreds of milliseconds per pan frame, per
// selection change, per snap guide, per drag of any OTHER object. Rendering
// such an object once into its own bitmap makes all of those a blit.
//
// A sprite is keyed on the object's immutable `paths` identity and holds the
// linear part of its transform (scale/mirror/rotate), its resolved paint, the
// alpha it was painted with and the view scale. Translation is applied at
// blit time, so moving the object or panning the view reuses the bitmap.
// Zooming reuses the previous bitmap as a scaled placeholder and repaints the
// exact sprite once the view has been quiet for SPRITE_SETTLE_MS, the same
// policy as the Preview route renderer. Objects whose bitmap would exceed the
// pixel cap (zoomed far in) are rendered for the visible viewport plus a
// margin and re-rendered when the view leaves that region.
//
// Placement is rounded to whole device pixels at blit time (at most half a
// pixel from the fractional position a direct paint would use); geometry,
// hit-testing and output never read a sprite.

import type { AABB, Transform } from '../../core/scene';
import type { ViewTransform } from './view-transform';

/** Objects drawing at least this many display segments are worth a sprite. */
export const SPRITE_MIN_DISPLAY_SEGMENTS = 4_000;
/** Quiet time after a zoom change before the exact sprite is repainted. */
export const SPRITE_SETTLE_MS = 150;
/** Bitmap margin around the geometry: half the widest stroke plus antialiasing. */
export const SPRITE_PAD_PX = 3;
const SPRITE_MAX_ENTRIES = 8;
const SPRITE_MAX_SIDE_PX = 8192;
const SPRITE_MIN_PIXEL_CAP = 4_000_000;
const SPRITE_VIEWPORT_CAP_FACTOR = 2.25;
const SPRITE_BUDGET_FACTOR = 3;
const CLIP_MARGIN_FRACTION = 0.25;

/** Extent in object space after scale/mirror/rotate, before translation (mm). */
type Region = AABB;

type Entry = {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  linearKey: string;
  styleKey: string;
  alpha: number;
  scale: number;
  bounds: Region;
  region: Region;
  clipped: boolean;
  pendingScale: number | null;
  pendingAt: number;
  lastUsed: number;
  evicted: boolean;
};

export type SpritePainter = (ctx: CanvasRenderingContext2D, view: ViewTransform) => void;

export type SpriteRequest = {
  readonly ctx: CanvasRenderingContext2D;
  /** Identity of the object's geometry (its immutable `paths` array). */
  readonly key: object;
  readonly transform: Transform;
  readonly view: ViewTransform;
  /** Changes whenever the object would paint differently at the same scale. */
  readonly styleKey: string;
  /** Actual geometry extent in object space before translation; read only when rendering. */
  readonly measure: () => AABB;
  readonly paint: SpritePainter;
  readonly requestRedraw?: (() => void) | undefined;
};

const entries = new WeakMap<object, Entry>();
let recent: Entry[] = [];
let useCounter = 0;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Draw an object from its sprite, rendering or refreshing the sprite first
 * when needed. Returns false when sprites are unavailable here or the object
 * cannot be given one, in which case the caller paints directly.
 */
export function drawArtworkSprite(request: SpriteRequest): boolean {
  const { ctx, view } = request;
  if (!spritesSupported(ctx)) return false;
  const alpha = ctx.globalAlpha;
  const linearKey = linearTransformKey(request.transform);
  const entry = liveEntry(request.key);
  useCounter += 1;
  if (entry !== undefined && matchesContent(entry, linearKey, request.styleKey, alpha)) {
    entry.lastUsed = useCounter;
    if (entry.scale === view.scale) {
      entry.pendingScale = null;
      if (!entry.clipped || coversViewport(entry, request)) {
        blit(ctx, entry, request, 1);
        return true;
      }
    } else if (holdPlaceholder(entry, request)) {
      blit(ctx, entry, request, view.scale / entry.scale);
      return true;
    }
  }
  const rendered = render(entry, request, linearKey, alpha);
  if (rendered === null) return false;
  blit(ctx, rendered, request, 1);
  return true;
}

export function resetArtworkSpritesForTests(): void {
  for (const entry of recent) drop(entry);
  recent = [];
  useCounter = 0;
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = null;
}

function spritesSupported(ctx: CanvasRenderingContext2D): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    ctx.canvas instanceof HTMLCanvasElement &&
    typeof ctx.drawImage === 'function'
  );
}

function liveEntry(key: object): Entry | undefined {
  const entry = entries.get(key);
  return entry === undefined || entry.evicted ? undefined : entry;
}

function matchesContent(entry: Entry, linearKey: string, styleKey: string, alpha: number): boolean {
  return entry.linearKey === linearKey && entry.styleKey === styleKey && entry.alpha === alpha;
}

// Between zoom steps the previous bitmap is shown scaled; the exact repaint
// waits until the scale has been unchanged for SPRITE_SETTLE_MS.
function holdPlaceholder(entry: Entry, request: SpriteRequest): boolean {
  const now = performance.now();
  if (entry.pendingScale !== request.view.scale) {
    entry.pendingScale = request.view.scale;
    entry.pendingAt = now;
  } else if (now - entry.pendingAt >= SPRITE_SETTLE_MS) {
    return false;
  }
  armSettle(request.requestRedraw, entry.pendingAt + SPRITE_SETTLE_MS - now);
  return true;
}

function armSettle(requestRedraw: (() => void) | undefined, delayMs: number): void {
  if (requestRedraw === undefined) return;
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = setTimeout(
    () => {
      settleTimer = null;
      requestRedraw();
    },
    Math.max(0, delayMs),
  );
}

function coversViewport(entry: Entry, request: SpriteRequest): boolean {
  const needed = intersect(viewportRegion(request, 0), entry.bounds);
  if (needed === null) return true;
  const epsilon = 1e-9;
  return (
    needed.minX >= entry.region.minX - epsilon &&
    needed.minY >= entry.region.minY - epsilon &&
    needed.maxX <= entry.region.maxX + epsilon &&
    needed.maxY <= entry.region.maxY + epsilon
  );
}

function render(
  existing: Entry | undefined,
  request: SpriteRequest,
  linearKey: string,
  alpha: number,
): Entry | null {
  const { view, transform } = request;
  const bounds = request.measure();
  const chosen = chooseRegion(bounds, request);
  if (chosen === null) return null;
  const width =
    Math.ceil((chosen.region.maxX - chosen.region.minX) * view.scale) + 2 * SPRITE_PAD_PX;
  const height =
    Math.ceil((chosen.region.maxY - chosen.region.minY) * view.scale) + 2 * SPRITE_PAD_PX;
  const entry = existing ?? createEntry();
  if (entry === null) return null;
  if (entry.canvas.width !== width || entry.canvas.height !== height) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  } else {
    entry.context.clearRect(0, 0, width, height);
  }
  entry.context.save();
  entry.context.globalAlpha = alpha;
  request.paint(entry.context, {
    scale: view.scale,
    offsetX: SPRITE_PAD_PX - (transform.x + chosen.region.minX) * view.scale,
    offsetY: SPRITE_PAD_PX - (transform.y + chosen.region.minY) * view.scale,
  });
  entry.context.restore();
  entry.linearKey = linearKey;
  entry.styleKey = request.styleKey;
  entry.alpha = alpha;
  entry.scale = view.scale;
  entry.bounds = bounds;
  entry.region = chosen.region;
  entry.clipped = chosen.clipped;
  entry.pendingScale = null;
  entry.lastUsed = useCounter;
  if (existing === undefined) {
    entries.set(request.key, entry);
    recent.push(entry);
  }
  enforceBudget(entry, request.ctx.canvas);
  return entry;
}

function createEntry(): Entry | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context === null) return null;
  return {
    canvas,
    context,
    linearKey: '',
    styleKey: '',
    alpha: 1,
    scale: 0,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    region: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    clipped: false,
    pendingScale: null,
    pendingAt: 0,
    lastUsed: 0,
    evicted: false,
  };
}

function chooseRegion(
  bounds: AABB,
  request: SpriteRequest,
): { readonly region: Region; readonly clipped: boolean } | null {
  const cap = pixelCap(request.ctx.canvas);
  if (fitsBudget(bounds, request.view.scale, cap)) return { region: bounds, clipped: false };
  const region = intersect(viewportRegion(request, CLIP_MARGIN_FRACTION), bounds);
  if (region === null || !fitsBudget(region, request.view.scale, cap)) return null;
  return { region, clipped: true };
}

function pixelCap(canvas: HTMLCanvasElement): number {
  return Math.max(SPRITE_MIN_PIXEL_CAP, canvas.width * canvas.height * SPRITE_VIEWPORT_CAP_FACTOR);
}

function fitsBudget(region: Region, scale: number, cap: number): boolean {
  const width = (region.maxX - region.minX) * scale + 2 * SPRITE_PAD_PX;
  const height = (region.maxY - region.minY) * scale + 2 * SPRITE_PAD_PX;
  return width <= SPRITE_MAX_SIDE_PX && height <= SPRITE_MAX_SIDE_PX && width * height <= cap;
}

// The visible canvas (plus a margin) expressed in the object's untranslated space.
function viewportRegion(request: SpriteRequest, marginFraction: number): Region {
  const { view, transform, ctx } = request;
  const marginX = ctx.canvas.width * marginFraction;
  const marginY = ctx.canvas.height * marginFraction;
  return {
    minX: (-marginX - view.offsetX) / view.scale - transform.x,
    minY: (-marginY - view.offsetY) / view.scale - transform.y,
    maxX: (ctx.canvas.width + marginX - view.offsetX) / view.scale - transform.x,
    maxY: (ctx.canvas.height + marginY - view.offsetY) / view.scale - transform.y,
  };
}

function intersect(a: Region, b: Region): Region | null {
  const region = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
  return region.minX <= region.maxX && region.minY <= region.maxY ? region : null;
}

function blit(
  ctx: CanvasRenderingContext2D,
  entry: Entry,
  request: SpriteRequest,
  ratio: number,
): void {
  const { view, transform } = request;
  const originX = view.offsetX + (transform.x + entry.region.minX) * view.scale;
  const originY = view.offsetY + (transform.y + entry.region.minY) * view.scale;
  ctx.save();
  ctx.globalAlpha = 1;
  if (ratio === 1) {
    ctx.drawImage(
      entry.canvas,
      Math.round(originX) - SPRITE_PAD_PX,
      Math.round(originY) - SPRITE_PAD_PX,
    );
  } else {
    ctx.drawImage(
      entry.canvas,
      originX - SPRITE_PAD_PX * ratio,
      originY - SPRITE_PAD_PX * ratio,
      entry.canvas.width * ratio,
      entry.canvas.height * ratio,
    );
  }
  ctx.restore();
}

function enforceBudget(keep: Entry, target: HTMLCanvasElement): void {
  const budget = pixelCap(target) * SPRITE_BUDGET_FACTOR;
  const byAge = [...recent].sort((a, b) => a.lastUsed - b.lastUsed);
  let pixels = recent.reduce((sum, entry) => sum + entry.canvas.width * entry.canvas.height, 0);
  for (const entry of byAge) {
    if (recent.length <= SPRITE_MAX_ENTRIES && pixels <= budget) return;
    if (entry === keep) continue;
    pixels -= entry.canvas.width * entry.canvas.height;
    drop(entry);
    recent = recent.filter((candidate) => candidate !== entry);
  }
}

function drop(entry: Entry): void {
  entry.evicted = true;
  entry.canvas.width = 0;
  entry.canvas.height = 0;
}

function linearTransformKey(transform: Transform): string {
  return `${transform.scaleX}|${transform.scaleY}|${transform.rotationDeg}|${transform.mirrorX ? 1 : 0}|${transform.mirrorY ? 1 : 0}`;
}
