/**
 * === FILE: /src/ui/viewport.ts ===
 *
 * Purpose:    Pure viewport math: screen↔world coordinate transforms,
 *             zoom, pan. No React, no Canvas — just numbers in, numbers out.
 *             Independently testable.
 *
 * Coordinate spaces:
 *   Screen — pixel position on the HTML canvas element
 *   World  — mm position on the laser bed
 *
 * Dependencies: /src/core/types.ts
 * Last updated: Refactor — extracted Transform object
 */

import { type Point, type AABB } from '../core/types';

// ─── VIEWPORT STATE ──────────────────────────────────────────────

export interface ViewportState {
  offsetX: number;    // Screen pixels: translation X
  offsetY: number;    // Screen pixels: translation Y
  zoom: number;       // Scale factor: 1.0 = 1px per mm
}

export const DEFAULT_VIEWPORT: ViewportState = {
  offsetX: 40,
  offsetY: 40,
  zoom: 1.5,
};

// ─── TRANSFORM ───────────────────────────────────────────────────
/**
 * Encapsulates viewport coordinate math.
 *
 * Renderers receive this instead of raw ViewportState.
 * Provides two capabilities:
 *   1. Coordinate conversion: worldToScreen / screenToWorld
 *   2. Zoom compensation: screenPx(n) converts n screen pixels
 *      to world units so strokes/sizes appear constant on screen.
 */
export class Transform {
  constructor(private readonly state: ViewportState) {}

  /** Current zoom level (read-only). */
  get zoom(): number { return this.state.zoom; }

  /** Convert world-space point to screen-space point. */
  worldToScreen(p: Point): Point {
    return {
      x: p.x * this.state.zoom + this.state.offsetX,
      y: p.y * this.state.zoom + this.state.offsetY,
    };
  }

  /** Convert screen-space point to world-space point. */
  screenToWorld(p: Point): Point {
    return {
      x: (p.x - this.state.offsetX) / this.state.zoom,
      y: (p.y - this.state.offsetY) / this.state.zoom,
    };
  }

  /**
   * Convert screen pixels to world units at current zoom.
   * Use for line widths, marker sizes, dash patterns —
   * anything that should appear constant on screen.
   *
   * Replaces the `N / vp.zoom` pattern everywhere.
   */
  screenPx(pixels: number): number {
    return pixels / this.state.zoom;
  }

  /** Apply this transform to a Canvas2D context. */
  applyToContext(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.state.offsetX, this.state.offsetY);
    ctx.scale(this.state.zoom, this.state.zoom);
  }

  /**
   * Compute the world-space AABB visible within the canvas.
   * Used for frustum culling — skip rendering anything outside this box.
   */
  getVisibleWorldBounds(canvasWidth: number, canvasHeight: number): AABB {
    const topLeft = this.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.screenToWorld({ x: canvasWidth, y: canvasHeight });
    return {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
    };
  }

  /** Create a Transform from a ViewportState. */
  static from(vp: ViewportState): Transform {
    return new Transform(vp);
  }
}

// ─── COORDINATE TRANSFORMS (free functions, backward compat) ────

/** Convert screen pixel position to world mm position. */
export function screenToWorld(sx: number, sy: number, vp: ViewportState): Point {
  return {
    x: (sx - vp.offsetX) / vp.zoom,
    y: (sy - vp.offsetY) / vp.zoom,
  };
}

/** Convert world mm position to screen pixel position. */
export function worldToScreen(wx: number, wy: number, vp: ViewportState): Point {
  return {
    x: wx * vp.zoom + vp.offsetX,
    y: wy * vp.zoom + vp.offsetY,
  };
}

/** Convert a world-space distance to screen pixels. */
export function worldToScreenDist(worldDist: number, vp: ViewportState): number {
  return worldDist * vp.zoom;
}

/** Convert a screen-pixel distance to world mm. */
export function screenToWorldDist(screenDist: number, vp: ViewportState): number {
  return screenDist / vp.zoom;
}

// ─── ZOOM ────────────────────────────────────────────────────────

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 50;

/**
 * Zoom centered on a screen-space anchor point.
 * The world point under the cursor stays fixed on screen.
 */
export function zoomAt(
  vp: ViewportState,
  anchorSx: number,
  anchorSy: number,
  factor: number
): ViewportState {
  const newZoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  return {
    zoom: newZoom,
    offsetX: anchorSx - (anchorSx - vp.offsetX) * (newZoom / vp.zoom),
    offsetY: anchorSy - (anchorSy - vp.offsetY) * (newZoom / vp.zoom),
  };
}

/**
 * Compute zoom factor from mouse wheel deltaY.
 * Positive delta = zoom out, negative = zoom in.
 */
export function wheelToZoomFactor(deltaY: number): number {
  return deltaY < 0 ? 1.1 : 1 / 1.1;
}

// ─── PAN ─────────────────────────────────────────────────────────

/** Apply a screen-space pan delta. */
export function pan(vp: ViewportState, dx: number, dy: number): ViewportState {
  return {
    ...vp,
    offsetX: vp.offsetX + dx,
    offsetY: vp.offsetY + dy,
  };
}

// ─── FIT TO BOUNDS ───────────────────────────────────────────────

/**
 * Calculate viewport that fits a world-space rectangle into
 * a screen-space canvas, with padding.
 */
export function fitToBounds(
  worldMinX: number,
  worldMinY: number,
  worldMaxX: number,
  worldMaxY: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 40
): ViewportState {
  const worldW = worldMaxX - worldMinX;
  const worldH = worldMaxY - worldMinY;

  if (worldW <= 0 || worldH <= 0) return DEFAULT_VIEWPORT;

  const availW = canvasWidth - padding * 2;
  const availH = canvasHeight - padding * 2;

  const zoom = Math.min(availW / worldW, availH / worldH);

  const centerWorldX = worldMinX + worldW / 2;
  const centerWorldY = worldMinY + worldH / 2;

  return {
    zoom,
    offsetX: canvasWidth / 2 - centerWorldX * zoom,
    offsetY: canvasHeight / 2 - centerWorldY * zoom,
  };
}

/**
 * Calculate viewport that fits an AABB into the canvas.
 * Convenience wrapper over fitToBounds.
 *
 * @param paddingPercent  Padding as fraction of content size (0.1 = 10%)
 */
export function fitToAABB(
  bounds: AABB,
  canvasWidth: number,
  canvasHeight: number,
  paddingPercent: number = 0.1
): ViewportState {
  // Guard against empty/infinite bounds
  if (!isFinite(bounds.minX) || !isFinite(bounds.maxX) ||
      !isFinite(bounds.minY) || !isFinite(bounds.maxY)) {
    return DEFAULT_VIEWPORT;
  }

  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;

  if (w <= 0 && h <= 0) return DEFAULT_VIEWPORT;

  // Convert percentage padding to world units,
  // then to screen pixels via initial zoom estimate
  const padW = Math.max(w, 1) * paddingPercent;
  const padH = Math.max(h, 1) * paddingPercent;

  return fitToBounds(
    bounds.minX - padW,
    bounds.minY - padH,
    bounds.maxX + padW,
    bounds.maxY + padH,
    canvasWidth,
    canvasHeight,
    0  // pixel padding = 0, already handled by world-space expansion
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
