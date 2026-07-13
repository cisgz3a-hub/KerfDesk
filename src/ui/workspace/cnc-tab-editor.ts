import { cncTabAnchorPosition } from '../../core/cnc';
import type { SceneObject, Vec2 } from '../../core/scene';
import type { ViewTransform } from './view-transform';
import { canvasTheme } from '../theme/canvas-theme';

export type CncTabDragState = {
  readonly kind: 'cnc-tab';
  readonly anchorIndex: number;
  readonly layerColor: string;
};

const HANDLE_RADIUS_PX = 7;

export function hitCncTabAnchor(
  object: SceneObject,
  layerColor: string,
  point: Vec2,
  pxToMm: number,
): CncTabDragState | null {
  const anchors = object.cncTabAnchors ?? [];
  let best: { readonly index: number; readonly distance: number } | null = null;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (anchor === undefined || anchor.layerColor !== layerColor) continue;
    const position = cncTabAnchorPosition(object, anchor);
    if (position === null) continue;
    const distance = Math.hypot(position.x - point.x, position.y - point.y);
    if (distance <= HANDLE_RADIUS_PX * pxToMm && (best === null || distance < best.distance)) {
      best = { index, distance };
    }
  }
  return best === null ? null : { kind: 'cnc-tab', anchorIndex: best.index, layerColor };
}

export function drawCncTabAnchors(
  ctx: CanvasRenderingContext2D,
  object: SceneObject,
  layerColor: string,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.fillStyle = canvasTheme.cncTabHandleFill;
  ctx.strokeStyle = canvasTheme.cncTabHandleStroke;
  ctx.lineWidth = 1.5;
  for (const anchor of object.cncTabAnchors ?? []) {
    if (anchor.layerColor !== layerColor) continue;
    const position = cncTabAnchorPosition(object, anchor);
    if (position === null) continue;
    const x = view.offsetX + position.x * view.scale;
    const y = view.offsetY + position.y * view.scale;
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
