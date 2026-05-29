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
  const usableW = canvasW - PADDING_PX * 2;
  const usableH = canvasH - PADDING_PX * 2;
  const baseScale = Math.min(usableW / bedW, usableH / bedH);
  const scale = baseScale * view.zoomFactor;
  // Center the bed in the canvas at the new scale, then apply the user pan.
  // Pan is in scene-mm so it's applied before the px multiplication.
  return {
    scale,
    offsetX: (canvasW - bedW * scale) / 2 + view.panX * scale,
    offsetY: (canvasH - bedH * scale) / 2 + view.panY * scale,
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
  return v.scale === 0 ? 1 : 1 / v.scale;
}

export function canvasMouseToScene(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement | null,
  project: Project,
  view: ViewState = DEFAULT_VIEW_STATE,
): Vec2 | null {
  if (canvas === null) return null;
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const v = computeView(
    canvas.width,
    canvas.height,
    project.device.bedWidth,
    project.device.bedHeight,
    view,
  );
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
  const v0 = computeView(canvas.width, canvas.height, bed.width, bed.height, view);
  if (v0.scale === 0) return view;
  const sceneBeforeX = (cursorPx.x - v0.offsetX) / v0.scale;
  const sceneBeforeY = (cursorPx.y - v0.offsetY) / v0.scale;
  const nextView: ViewState = { ...view, zoomFactor: view.zoomFactor * factor };
  const v1 = computeView(canvas.width, canvas.height, bed.width, bed.height, nextView);
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
  return {
    x: ((client.clientX - rect.left) / rect.width) * canvas.width,
    y: ((client.clientY - rect.top) / rect.height) * canvas.height,
  };
}
