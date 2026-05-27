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
