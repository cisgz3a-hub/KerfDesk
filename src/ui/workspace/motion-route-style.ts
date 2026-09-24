import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { burnWidthPx, MIN_BURN_PX } from './draw-burn-trail';
import { ARTWORK_HAIRLINE_WIDTH_PX, HAIRLINE_STROKE_SEGMENT_THRESHOLD } from './draw-complexity';
import type { ViewTransform } from './view-transform';

export type RoutePalette = {
  /** Route not yet confirmed by the controller. */
  readonly planned: string;
  /** Settled burn behind the head. */
  readonly scorch: string;
  /** Confirmed rapid — travelled, but nothing was cut there. */
  readonly travel: string;
};

/**
 * Opacity the whole confirmed trail composites at, applied ONCE.
 *
 * The scorch is painted opaque into its raster so that overlapping burns are
 * idempotent: a raster fill whose hatch lines land under a pixel apart settles
 * at exactly this opacity instead of accumulating toward solid, which is what
 * turned a finished fill into a blank mass over the artwork.
 */
export const TRAIL_ALPHA = 0.62;
export const PLANNED_WIDTH_PX = 1.2;
export const TRAVEL_WIDTH_PX = 1;
export const TRAVEL_DASH_PX = [2, 6];
/**
 * Rapids recede hard. A raster fill returns the head once per hatch row, so at
 * working zoom the travel strokes alone outnumber the burn and — drawn at the
 * same weight — they pack into a slab that reads as solid material.
 */
export const TRAVEL_ALPHA_FACTOR = 0.3;

/**
 * One device pixel as Skia's hairline test sees it. A route is stroked through
 * the view scale, so its width is scaled back up in float32 and an exact 1 px
 * can land an ulp above the cliff — where the full stroker costs ~60x more
 * (ADR-346). Asking for a hair under one pixel keeps every <= 1 px stroke on
 * the hairline path without a visible change in weight.
 */
const HAIRLINE_DEVICE_PX = 0.999;

export type StrokeStyle = {
  readonly color: string;
  readonly widthPx: number;
  readonly dashPx?: ReadonlyArray<number>;
  readonly alpha?: number;
  readonly lineCap?: CanvasLineCap;
};

/** Device-pixel widths one route raster is painted with, fixed for its life. */
export type RouteRasterWidths = {
  readonly plannedPx: number;
  readonly scorchPx: number;
};

/**
 * ADR-346's hairline policy applied to the burn route.
 *
 * The planned route (1.2 px) and the scorch floor (1.1 px) sat just above the
 * one-pixel cliff, so a plan of hundreds of thousands of segments cost about a
 * second to restroke. A plan at the artwork hairline threshold draws both as
 * 1 px hairlines: while the kerf-scaled scorch is pinned at its floor the width
 * carries no kerf information, and the thinner line moves the inked pixels by
 * a few percent at most (motion-route-visual.test.ts). Zoomed in far enough
 * that the kerf itself is wider than the floor, the scorch keeps its true
 * width; the raster culls to the viewport, so only on-screen segments pay the
 * stroker. Smaller plans keep their weights.
 */
export function routeRasterWidths(
  plan: CanvasMotionPlan,
  view: ViewTransform,
  segmentCount: number,
): RouteRasterWidths {
  const burnPx = burnWidthPx(plan, view);
  if (segmentCount < HAIRLINE_STROKE_SEGMENT_THRESHOLD) {
    return { plannedPx: PLANNED_WIDTH_PX, scorchPx: burnPx };
  }
  return {
    plannedPx: ARTWORK_HAIRLINE_WIDTH_PX,
    scorchPx: burnPx <= MIN_BURN_PX ? ARTWORK_HAIRLINE_WIDTH_PX : burnPx,
  };
}

/**
 * Round caps exist to close the joint gaps between separately emitted wide
 * segments; a hairline has no width to leave a gap, so it takes plain butts.
 */
export function routeLineCap(widthPx: number): CanvasLineCap {
  return widthPx <= 1 ? 'butt' : 'round';
}

export function scorchStyle(
  palette: RoutePalette,
  plan: CanvasMotionPlan,
  view: ViewTransform,
): StrokeStyle {
  return { color: palette.scorch, widthPx: burnWidthPx(plan, view), alpha: TRAIL_ALPHA };
}

export function travelStyle(palette: RoutePalette): StrokeStyle {
  return {
    color: palette.travel,
    widthPx: TRAVEL_WIDTH_PX,
    dashPx: TRAVEL_DASH_PX,
    alpha: TRAIL_ALPHA * TRAVEL_ALPHA_FACTOR,
  };
}

export function strokeScenePath(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  view: ViewTransform,
  style: StrokeStyle,
): void {
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = (style.widthPx <= 1 ? HAIRLINE_DEVICE_PX : style.widthPx) / view.scale;
  // Rapids and append boundaries are separate subpaths, so a wide stroke with
  // butt caps would leave a visible gap at every such joint on a curve.
  ctx.lineCap = style.lineCap ?? 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash((style.dashPx ?? []).map((value) => value / view.scale));
  ctx.stroke(path);
  ctx.restore();
}
