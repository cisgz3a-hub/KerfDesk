// Pure viewing maths for the trace preview. Zoom is relative to Fit: at zoom z
// the stage is z times the viewport on both axes, and the fitted artwork scales
// with it, so a stage-normalised point is the same image point at every zoom.

export const MIN_PREVIEW_ZOOM = 1;
export const MAX_PREVIEW_ZOOM = 16;
// Very large sources may still need a closer look than 16x Fit: allow up to
// four screen pixels per source pixel, bounded so the stage stays sane.
const MAX_SCREEN_PX_PER_IMAGE_PX = 4;
const ABSOLUTE_MAX_ZOOM = 64;
const ZOOM_EPSILON = 1e-9;

type Size = { readonly width: number; readonly height: number };

export type PreviewZoomRange = {
  readonly min: number;
  readonly max: number;
  /** Zoom at which one source pixel spans one CSS pixel, when measurable. */
  readonly actualSize: number | null;
};

export const DEFAULT_PREVIEW_ZOOM_RANGE: PreviewZoomRange = {
  min: MIN_PREVIEW_ZOOM,
  max: MAX_PREVIEW_ZOOM,
  actualSize: null,
};

export function previewZoomRange(image: Size | undefined, viewport: Size): PreviewZoomRange {
  if (image === undefined || !positive(image.width) || !positive(image.height)) {
    return DEFAULT_PREVIEW_ZOOM_RANGE;
  }
  if (!positive(viewport.width) || !positive(viewport.height)) return DEFAULT_PREVIEW_ZOOM_RANGE;
  const fitScale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const actualSize = 1 / fitScale;
  return {
    // Small sources fit larger than life; let 1:1 zoom out below Fit.
    min: Math.min(MIN_PREVIEW_ZOOM, actualSize),
    max: Math.min(
      ABSOLUTE_MAX_ZOOM,
      Math.max(MAX_PREVIEW_ZOOM, actualSize * MAX_SCREEN_PX_PER_IMAGE_PX),
    ),
    actualSize,
  };
}

export function clampPreviewZoom(value: number, range: PreviewZoomRange): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.max(range.min, Math.min(range.max, value));
}

/**
 * Clamp a requested zoom without ever moving against the request: after the
 * range shifted (resize, stacked layout), a zoom-out below the new minimum must
 * not snap the view IN to that minimum, nor a zoom-in above the new maximum
 * snap it out. Returns `current` when the clamped value would reverse direction.
 */
export function clampPreviewZoomToward(
  current: number,
  value: number,
  range: PreviewZoomRange,
): number {
  const next = clampPreviewZoom(value, range);
  if (!Number.isFinite(next)) return next;
  if (value < current && next > current) return current;
  if (value > current && next < current) return current;
  return next;
}

/** The 1:1 zoom when the current range can show it, otherwise null. */
export function reachableActualSize(range: PreviewZoomRange): number | null {
  const actual = range.actualSize;
  if (actual === null) return null;
  const tolerance = ZOOM_EPSILON * Math.max(1, actual);
  return actual >= range.min - tolerance && actual <= range.max + tolerance ? actual : null;
}

/** Button/keyboard steps double or halve, but stop at Fit when they cross it. */
export function stepPreviewZoom(zoom: number, direction: 1 | -1): number {
  const next = direction > 0 ? zoom * 2 : zoom / 2;
  const crossesFit =
    direction > 0
      ? zoom < MIN_PREVIEW_ZOOM - ZOOM_EPSILON && next > MIN_PREVIEW_ZOOM
      : zoom > MIN_PREVIEW_ZOOM + ZOOM_EPSILON && next < MIN_PREVIEW_ZOOM;
  return crossesFit ? MIN_PREVIEW_ZOOM : next;
}

export function isAtZoomLimit(zoom: number, limit: number): boolean {
  return Math.abs(zoom - limit) <= ZOOM_EPSILON * Math.max(1, limit);
}

/**
 * Scroll offset on one axis that keeps the content under viewport-local point
 * `anchor` stationary while the stage grows from `previous` to `next` times the
 * viewport `size`. A stage smaller than the viewport is centred (CSS auto
 * margins), so its margin participates; the result is clamped to the scrollable
 * range, which is where the browser would clamp it anyway.
 */
export function anchoredScrollOffset(args: {
  readonly scroll: number;
  readonly anchor: number;
  readonly size: number;
  readonly previous: number;
  readonly next: number;
}): number {
  const { scroll, anchor, size, previous, next } = args;
  if (!positive(size) || !positive(previous) || !positive(next)) return 0;
  const previousStage = previous * size;
  const nextStage = next * size;
  const stagePoint = scroll + anchor - centredMargin(size, previousStage);
  const ratio = Math.max(0, Math.min(1, stagePoint / previousStage));
  const target = ratio * nextStage + centredMargin(size, nextStage) - anchor;
  return Math.max(0, Math.min(Math.max(0, nextStage - size), target));
}

/** A scroll offset clamped to the range of a stage `zoom` times `size`. */
export function clampScrollOffset(offset: number, size: number, zoom: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(Math.max(0, zoom * size - size), offset));
}

/**
 * The transform that makes a stage laid out at `rendered` zoom and scrolled to
 * `scroll` look exactly as it will once re-laid at `target` zoom and scrolled
 * to `targetScroll`: the stage origin moves by `x`/`y` screen px and the
 * content scales by `scale` about that origin. Auto-margin centring counts on
 * both sides, as in `anchoredScrollOffset`.
 */
export function liveLensTransform(args: {
  readonly size: Size;
  readonly rendered: number;
  readonly target: number;
  readonly scroll: { readonly left: number; readonly top: number };
  readonly targetScroll: { readonly left: number; readonly top: number };
}): { readonly x: number; readonly y: number; readonly scale: number } | null {
  const { size, rendered, target, scroll, targetScroll } = args;
  if (!positive(size.width) || !positive(size.height)) return null;
  if (!positive(rendered) || !positive(target)) return null;
  const shift = (length: number, from: number, to: number): number =>
    centredMargin(length, target * length) - to - (centredMargin(length, rendered * length) - from);
  return {
    x: shift(size.width, scroll.left, targetScroll.left),
    y: shift(size.height, scroll.top, targetScroll.top),
    scale: target / rendered,
  };
}

export function formatPreviewZoom(zoom: number): string {
  if (!Number.isFinite(zoom)) return '1';
  const rounded = zoom >= 10 ? Math.round(zoom) : Math.round(zoom * 10) / 10;
  if (rounded > 0) return String(rounded);
  return String(Math.round(zoom * 100) / 100);
}

function centredMargin(size: number, stage: number): number {
  return Math.max(0, (size - stage) / 2);
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
