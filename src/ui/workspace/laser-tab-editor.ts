// The laser Line tab tool on the canvas (ADR-494, LBG-C05). A press on a
// placed tab drags it; released without moving, it removes the tab. A press on
// one of the selected artwork's contours places a tab there. Placed tabs draw
// filled, like the CNC tab handles; where a contour has none, its automatic
// tabs draw hollow, so it is plain which tabs a click will replace.

import { automaticLaserTabHints, laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import { effectiveOperationForObject } from '../../core/effective-output';
import {
  layerFromSubLayer,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { layerSubLayerOperationId } from '../../core/scene/layer';
import { useStore } from '../state';
import { canvasTheme } from '../theme/canvas-theme';
import {
  canvasMouseToScene,
  pxToMmForCanvas,
  type ViewState,
  type ViewTransform,
} from './view-transform';

export type LaserTabDragState = {
  readonly kind: 'laser-tab';
  readonly anchorIndex: number;
  readonly layerColor: string;
  readonly startClientX: number;
  readonly startClientY: number;
};

export type LaserTabEditor = { readonly layerColor: string; readonly operationId: string };

const HANDLE_RADIUS_PX = 7;
const PLACE_TOLERANCE_PX = 10;
const CLICK_SLOP_PX = 3;

// Drags whose pointer has left the click slop: releasing them keeps the move
// instead of removing the tab.
const movedDrags = new WeakSet<LaserTabDragState>();

export function hitLaserTabAnchor(
  object: SceneObject,
  layerColor: string,
  point: Vec2,
  pxToMm: number,
): number | null {
  const anchors = object.laserTabAnchors ?? [];
  let best: { readonly index: number; readonly distance: number } | null = null;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (anchor === undefined || anchor.layerColor !== layerColor) continue;
    const position = laserTabAnchorPosition(object, anchor);
    if (position === null) continue;
    const distance = Math.hypot(position.x - point.x, position.y - point.y);
    if (distance <= HANDLE_RADIUS_PX * pxToMm && (best === null || distance < best.distance)) {
      best = { index, distance };
    }
  }
  return best?.index ?? null;
}

/** Pointer down with the tool active: a drag of the tab under the pointer, or
 * null after placing a tab on the contour under it (or finding nothing). */
export function beginLaserTabPointer(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly selectedObjectId: string | null;
  readonly mode: LaserTabEditor;
}): LaserTabDragState | null {
  const point = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
  const object = args.project.scene.objects.find((item) => item.id === args.selectedObjectId);
  if (point === null || object === undefined) return null;
  const pxToMm = pxToMmForCanvas(args.canvas, args.project, args.viewState);
  const layerColor = args.mode.layerColor;
  const hit = hitLaserTabAnchor(object, layerColor, point, pxToMm);
  if (hit !== null) {
    return {
      kind: 'laser-tab',
      anchorIndex: hit,
      layerColor,
      startClientX: args.e.clientX,
      startClientY: args.e.clientY,
    };
  }
  useStore.getState().addSelectedLaserTabAnchor(layerColor, point, PLACE_TOLERANCE_PX * pxToMm);
  return null;
}

export function moveLaserTabDrag(
  drag: LaserTabDragState,
  clientX: number,
  clientY: number,
  point: Vec2 | null,
): void {
  if (Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY) > CLICK_SLOP_PX) {
    movedDrags.add(drag);
  }
  if (point === null || !movedDrags.has(drag)) return;
  useStore
    .getState()
    .setSelectedLaserTabAnchorDuringInteraction(drag.anchorIndex, drag.layerColor, point);
}

/** Pointer up: a drag keeps its move as one undo step; a click removes the tab. */
export function finishLaserTabDrag(drag: LaserTabDragState): void {
  const store = useStore.getState();
  if (movedDrags.has(drag)) {
    store.endInteraction();
    return;
  }
  store.cancelInteraction();
  store.removeSelectedLaserTabAnchor(drag.anchorIndex, drag.layerColor);
}

export function drawLaserTabAnchors(
  ctx: CanvasRenderingContext2D,
  project: Project,
  object: SceneObject,
  editor: LaserTabEditor,
  view: ViewTransform,
): void {
  const operation = operationById(project.scene.layers, editor.operationId);
  const hints =
    operation === null
      ? []
      : automaticLaserTabHints(
          object,
          editor.layerColor,
          effectiveOperationForObject(operation, object),
        );
  const placed = (object.laserTabAnchors ?? []).flatMap((anchor) => {
    if (anchor.layerColor !== editor.layerColor) return [];
    const position = laserTabAnchorPosition(object, anchor);
    return position === null ? [] : [position];
  });
  ctx.save();
  ctx.fillStyle = canvasTheme.cncTabHandleFill;
  ctx.strokeStyle = canvasTheme.cncTabHandleStroke;
  ctx.lineWidth = 1.5;
  for (const position of hints) drawHandle(ctx, position, view, false);
  for (const position of placed) drawHandle(ctx, position, view, true);
  ctx.restore();
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  position: Vec2,
  view: ViewTransform,
  filled: boolean,
): void {
  ctx.beginPath();
  ctx.arc(
    view.offsetX + position.x * view.scale,
    view.offsetY + position.y * view.scale,
    filled ? HANDLE_RADIUS_PX : HANDLE_RADIUS_PX - 2,
    0,
    Math.PI * 2,
  );
  if (filled) ctx.fill();
  ctx.stroke();
}

/** An operation or sub-operation by its operation id. */
export function operationById(layers: ReadonlyArray<Layer>, operationId: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === operationId) return layer;
    for (const subLayer of layer.subLayers) {
      if (layerSubLayerOperationId(layer.id, subLayer.id) === operationId) {
        return layerFromSubLayer(layer, subLayer);
      }
    }
  }
  return null;
}
