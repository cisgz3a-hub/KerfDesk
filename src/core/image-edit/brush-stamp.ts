// Brush stamp math for the Image Studio paint tools (ADR-242).
//
// A stroke is a chain of stamps. One stamp is a disc whose per-pixel alpha
// falls off radially: fully opaque inside `hardness * radius`, fading linearly
// to zero at the rim. Stamps write into a stroke-local coverage window with
// MAX blending, so overlapping stamps inside one stroke never darken beyond
// the stroke's opacity — Photoshop's "normal brush at 100% flow" semantics
// (accumulating flow is a deliberate later IE-2 refinement).

export type BrushTip =
  // Anti-aliased falloff rim (Brush tool).
  | { readonly kind: 'soft'; readonly hardness: number }
  // Hard 1-bit disc (Pencil tool) — alpha is 0 or 1, no rim blending.
  | { readonly kind: 'pixel' };

export type BrushParams = {
  readonly diameterPx: number;
  /** 0..1 whole-stroke opacity, applied once at composite time. */
  readonly opacity: number;
  readonly tip: BrushTip;
};

export const MIN_BRUSH_DIAMETER_PX = 1;
export const MAX_BRUSH_DIAMETER_PX = 1024;

/** A stroke-local alpha window; x/y locate it in document space. */
export type CoverageWindow = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: Float32Array;
};

export function clampBrushDiameter(diameterPx: number): number {
  return Math.min(MAX_BRUSH_DIAMETER_PX, Math.max(MIN_BRUSH_DIAMETER_PX, Math.floor(diameterPx)));
}

export function createCoverageWindow(
  x: number,
  y: number,
  width: number,
  height: number,
): CoverageWindow {
  return { x, y, width, height, alpha: new Float32Array(Math.max(0, width * height)) };
}

function stampAlphaAt(distance: number, radius: number, tip: BrushTip): number {
  if (tip.kind === 'pixel') return distance <= radius ? 1 : 0;
  const hardRadius = radius * Math.min(1, Math.max(0, tip.hardness));
  if (distance <= hardRadius) return 1;
  if (distance >= radius) return 0;
  return (radius - distance) / (radius - hardRadius);
}

/**
 * MAX-blend one stamp centred at document-space (cx, cy) into the window.
 * Pixels are sampled at their centres; a radius-0.5 pencil therefore inks
 * exactly the pixel under the cursor.
 */
export function stampInto(
  window: CoverageWindow,
  cx: number,
  cy: number,
  brush: BrushParams,
): void {
  const radius = clampBrushDiameter(brush.diameterPx) / 2;
  const left = Math.max(window.x, Math.floor(cx - radius));
  const right = Math.min(window.x + window.width - 1, Math.ceil(cx + radius));
  const top = Math.max(window.y, Math.floor(cy - radius));
  const bottom = Math.min(window.y + window.height - 1, Math.ceil(cy + radius));
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const alpha = stampAlphaAt(Math.hypot(dx, dy), radius, brush.tip);
      if (alpha <= 0) continue;
      const index = (py - window.y) * window.width + (px - window.x);
      const current = window.alpha[index] ?? 0;
      if (alpha > current) window.alpha[index] = alpha;
    }
  }
}
