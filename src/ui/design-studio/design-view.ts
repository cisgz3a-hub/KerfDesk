// design-view — millimetre/pixel conversion for the Design Studio canvas
// (ADR-271, DS-2). Pure and separately testable: every coordinate the canvas
// draws and every pointer position it reads goes through exactly these two
// functions, so the drawing and the hit-testing can never disagree about where
// a millimetre is.

import type { Vec2 } from '../../core/scene';
import type { DesignView } from './design-session';

export const MIN_PX_PER_MM = 0.05;
export const MAX_PX_PER_MM = 200;
// Fraction of the viewport left as breathing room when framing content.
const FIT_MARGIN = 0.08;

export function mmToPx(view: DesignView, point: Vec2): Vec2 {
  return {
    x: (point.x - view.panXmm) * view.pxPerMm,
    y: (point.y - view.panYmm) * view.pxPerMm,
  };
}

export function pxToMm(view: DesignView, point: Vec2): Vec2 {
  return {
    x: point.x / view.pxPerMm + view.panXmm,
    y: point.y / view.pxPerMm + view.panYmm,
  };
}

export function clampPxPerMm(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_PX_PER_MM, Math.max(MIN_PX_PER_MM, value));
}

// Frames a millimetre rectangle inside a pixel viewport. Used on open (frame
// the bed) and by Fit (frame the drawing).
export function fitView(args: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly originXmm: number;
  readonly originYmm: number;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
}): DesignView {
  const usableWidth = args.viewportWidthPx * (1 - FIT_MARGIN * 2);
  const usableHeight = args.viewportHeightPx * (1 - FIT_MARGIN * 2);
  const safeWidthMm = Math.max(args.widthMm, MIN_PX_PER_MM);
  const safeHeightMm = Math.max(args.heightMm, MIN_PX_PER_MM);
  const pxPerMm = clampPxPerMm(Math.min(usableWidth / safeWidthMm, usableHeight / safeHeightMm));
  // Centre the content: convert the leftover pixel margin back into millimetres
  // and shift the pan by half of it on each axis.
  const slackXmm = (args.viewportWidthPx / pxPerMm - args.widthMm) / 2;
  const slackYmm = (args.viewportHeightPx / pxPerMm - args.heightMm) / 2;
  return {
    pxPerMm,
    panXmm: args.originXmm - slackXmm,
    panYmm: args.originYmm - slackYmm,
  };
}

// Zoom about a fixed pixel point, so the millimetre under the cursor stays put.
export function zoomAt(view: DesignView, anchorPx: Vec2, factor: number): DesignView {
  const pxPerMm = clampPxPerMm(view.pxPerMm * factor);
  if (pxPerMm === view.pxPerMm) return view;
  const anchorMm = pxToMm(view, anchorPx);
  return {
    pxPerMm,
    panXmm: anchorMm.x - anchorPx.x / pxPerMm,
    panYmm: anchorMm.y - anchorPx.y / pxPerMm,
  };
}
