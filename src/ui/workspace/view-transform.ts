// Canvas viewport transform — the math that maps between scene millimeters
// and on-canvas pixels. Pure helpers used by Workspace.tsx (render +
// mouse-event handling) and by handles.ts (px-to-mm for hit-test).
//
// Layered model: there's a baseline "fit-to-bed" scale (the bed maximises
// in the canvas with PADDING_PX margin), and on top the user-controlled
// zoomFactor + pan offsets. zoomFactor of 1 = fit-to-bed; pan is in
// scene-mm, applied to the camera (positive panX shifts content left).

import type { Project, Vec2 } from '../../core/scene';

const PADDING_PX = 24;
const MIN_USABLE_PX = 1;

export type ViewTransform = {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

export type ViewState = {
  readonly zoomFactor: number;
  readonly panX: number;
  readonly panY: number;
};

const DEFAULT_VIEW_STATE: ViewState = { zoomFactor: 1, panX: 0, panY: 0 };

// Fit-to-bed layout, then multiply by the user zoom and shift by the pan.
export function computeView(
  canvasW: number,
  canvasH: number,
  bedW: number,
  bedH: number,
  view: ViewState = DEFAULT_VIEW_STATE,
): ViewTransform {
  const canvasWidth = positiveFiniteOr(canvasW, MIN_USABLE_PX);
  const canvasHeight = positiveFiniteOr(canvasH, MIN_USABLE_PX);
  const bedWidth = positiveFiniteOr(bedW, MIN_USABLE_PX);
  const bedHeight = positiveFiniteOr(bedH, MIN_USABLE_PX);
  const zoomFactor = positiveFiniteOr(view.zoomFactor, DEFAULT_VIEW_STATE.zoomFactor);
  const panX = finiteOr(view.panX, DEFAULT_VIEW_STATE.panX);
  const panY = finiteOr(view.panY, DEFAULT_VIEW_STATE.panY);
  const usableW = Math.max(MIN_USABLE_PX, canvasWidth - PADDING_PX * 2);
  const usableH = Math.max(MIN_USABLE_PX, canvasHeight - PADDING_PX * 2);
  const baseScale = Math.min(usableW / bedWidth, usableH / bedHeight);
  const scale = Math.max(Number.EPSILON, baseScale * zoomFactor);
  // Center the bed in the canvas at the new scale, then apply the user pan.
  // Pan is in scene-mm so it's applied before the px multiplication.
  return {
    scale,
    offsetX: (canvasWidth - bedWidth * scale) / 2 + panX * scale,
    offsetY: (canvasHeight - bedHeight * scale) / 2 + panY * scale,
  };
}

export function pxToMmForCanvas(
  canvas: HTMLCanvasElement | null,
  project: Project,
  view: ViewState = DEFAULT_VIEW_STATE,
): number {
  if (canvas === null) return 1;
  const v = computeView(
    canvas.width,
    canvas.height,
    project.device.bedWidth,
    project.device.bedHeight,
    view,
  );
  return isPositiveFinite(v.scale) ? 1 / v.scale : 1;
}

export function canvasMouseToScene(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement | null,
  project: Project,
  view: ViewState = DEFAULT_VIEW_STATE,
): Vec2 | null {
  if (canvas === null) return null;
  const rect = canvas.getBoundingClientRect();
  if (!isPositiveFinite(rect.width) || !isPositiveFinite(rect.height)) return null;
  if (!isPositiveFinite(canvas.width) || !isPositiveFinite(canvas.height)) return null;
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const v = computeView(
    canvas.width,
    canvas.height,
    project.device.bedWidth,
    project.device.bedHeight,
    view,
  );
  if (!isPositiveFinite(v.scale)) return null;
  return { x: (px - v.offsetX) / v.scale, y: (py - v.offsetY) / v.scale };
}

// Cursor-anchored zoom — the user's natural expectation when scrolling
// the wheel over the canvas is that the point under the cursor stays
// under the cursor as the view scales. Plain `zoomBy` instead keeps
// the bed center anchored, so wheel-zooming in a corner of the bed
// pulls content away from where the user is looking.
//
// Math: solve for (panX', panY') such that the scene-mm point under
// `cursorCanvasPx` is unchanged after the zoom. Pure — returns the
// next ViewState; the caller writes it to the store. Doesn't clamp
// zoomFactor itself; the store clamps in setZoom.
export function zoomAtCursorPx(args: {
  readonly cursorPx: { readonly x: number; readonly y: number };
  readonly factor: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly bed: { readonly width: number; readonly height: number };
  readonly view: ViewState;
}): ViewState {
  const { cursorPx, factor, canvas, bed, view } = args;
  if (!isPositiveFinite(factor)) return normalizeViewState(view);
  const safeView = normalizeViewState(view);
  const v0 = computeView(canvas.width, canvas.height, bed.width, bed.height, view);
  if (!isPositiveFinite(v0.scale)) return safeView;
  const sceneBeforeX = (cursorPx.x - v0.offsetX) / v0.scale;
  const sceneBeforeY = (cursorPx.y - v0.offsetY) / v0.scale;
  const nextView: ViewState = { ...safeView, zoomFactor: safeView.zoomFactor * factor };
  const v1 = computeView(canvas.width, canvas.height, bed.width, bed.height, nextView);
  if (!isPositiveFinite(v1.scale)) return safeView;
  const sceneAfterX = (cursorPx.x - v1.offsetX) / v1.scale;
  const sceneAfterY = (cursorPx.y - v1.offsetY) / v1.scale;
  // Positive panX shifts content right => scene under cursor decreases.
  // To pull sceneAfter back to sceneBefore, add (after - before) to pan.
  return {
    zoomFactor: nextView.zoomFactor,
    panX: view.panX + (sceneAfterX - sceneBeforeX),
    panY: view.panY + (sceneAfterY - sceneBeforeY),
  };
}

// Convert a viewport-space client (clientX/clientY) into canvas-px
// coordinates. Shared between the wheel handler (which needs the
// cursor px to anchor the zoom) and any future helper that wants to
// translate a raw mouse/wheel event without going through React's
// MouseEvent type — WheelEvent doesn't satisfy that constraint, but
// shares clientX/clientY.
export function clientToCanvasPx(
  client: { readonly clientX: number; readonly clientY: number },
  canvas: HTMLCanvasElement | null,
): { readonly x: number; readonly y: number } | null {
  if (canvas === null) return null;
  const rect = canvas.getBoundingClientRect();
  if (!isPositiveFinite(rect.width) || !isPositiveFinite(rect.height)) return null;
  if (!isPositiveFinite(canvas.width) || !isPositiveFinite(canvas.height)) return null;
  return {
    x: ((client.clientX - rect.left) / rect.width) * canvas.width,
    y: ((client.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function normalizeViewState(view: ViewState): ViewState {
  return {
    zoomFactor: positiveFiniteOr(view.zoomFactor, DEFAULT_VIEW_STATE.zoomFactor),
    panX: finiteOr(view.panX, DEFAULT_VIEW_STATE.panX),
    panY: finiteOr(view.panY, DEFAULT_VIEW_STATE.panY),
  };
}

function positiveFiniteOr(value: number, fallback: number): number {
  return isPositiveFinite(value) ? value : fallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
