// Halved display copies ("levels") of the pictures the design canvas scales
// (ADR-359 Amendment 1).
//
// Chromium prepares every drawImage source at the power-of-two level the
// draw's scale needs, synchronously, inside the canvas flush on the renderer
// main thread. A decoded bitmap or canvas drawn below half its size is
// rescaled on the CPU before its GPU upload, and done again at each new level.
// Wheel-zooming crosses such a level every seven or so notches, and each
// crossing stalled the canvas: about 275 ms per rescale of a 4096 px adjusted
// copy (Chromium 141, measured 2026-09-29).
//
// Drawing the smallest halved copy that is still at least the picture's size
// on screen keeps every draw between half and full size, so Chromium uses each
// copy as it is: built once, uploaded once, never rescaled while zooming. Each
// copy is one half-size bilinear blit of the one above it, which at exactly
// half size is a 2x2 box average. It is built on a CPU canvas so that building
// it never uploads the larger copy. Display only: nothing else reads a level.

type LevelSource = HTMLCanvasElement | ImageBitmap;

/** Halving stops before a copy this small; below it a rescale costs nothing. */
export const MIN_DISPLAY_LEVEL_EDGE_PX = 32;

// Level i is half of level i - 1, and level 0 is half of the source itself.
const levelsBySource = new WeakMap<LevelSource, HTMLCanvasElement[]>();

/**
 * The copy of `source` to draw at `drawnWidthPx` x `drawnHeightPx` device
 * pixels: the smallest halved copy still at least that size, or the source
 * itself when it is drawn at more than half its size. A lazily decoded
 * `<img>`, or any source this module cannot copy, is returned unchanged.
 */
export function displayLevel(
  source: CanvasImageSource,
  drawnWidthPx: number,
  drawnHeightPx: number,
): CanvasImageSource {
  if (!isLevelSource(source) || !(drawnWidthPx > 0) || !(drawnHeightPx > 0)) return source;
  const levels = levelsBySource.get(source) ?? [];
  let chosen: LevelSource = source;
  for (let index = 0; ; index += 1) {
    const width = Math.ceil(chosen.width / 2);
    const height = Math.ceil(chosen.height / 2);
    if (!halfStillCovers(width, height, drawnWidthPx, drawnHeightPx)) return chosen;
    const next = levels[index] ?? appendLevel(source, levels, chosen, width, height);
    if (next === null) return chosen;
    chosen = next;
  }
}

/** Frees the halved copies of a source its owner is dropping. */
export function releaseDisplayLevels(source: CanvasImageSource): void {
  if (!isLevelSource(source)) return;
  for (const level of levelsBySource.get(source) ?? []) {
    level.width = 0;
    level.height = 0;
  }
  levelsBySource.delete(source);
}

function halfStillCovers(
  width: number,
  height: number,
  drawnWidthPx: number,
  drawnHeightPx: number,
): boolean {
  return (
    width >= drawnWidthPx &&
    height >= drawnHeightPx &&
    Math.min(width, height) >= MIN_DISPLAY_LEVEL_EDGE_PX
  );
}

function appendLevel(
  source: LevelSource,
  levels: HTMLCanvasElement[],
  from: LevelSource,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(from, 0, 0, width, height);
  levels.push(canvas);
  levelsBySource.set(source, levels);
  return canvas;
}

function isLevelSource(source: CanvasImageSource): source is LevelSource {
  return (
    (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
  );
}
