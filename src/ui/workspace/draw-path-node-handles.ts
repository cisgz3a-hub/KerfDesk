import { applyTransform, type SceneObject, type Vec2 } from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

const NODE_HANDLE_PX = 6;
const ACTIVE_NODE_HANDLE_PX = 8;

export function drawPathNodeHandles(
  ctx: CanvasRenderingContext2D,
  object: SceneObject,
  view: ViewTransform,
  selectedNode: PathNodeRef | null = null,
  selectedNodes: ReadonlyArray<PathNodeRef> = selectedNode === null ? [] : [selectedNode],
): void {
  if (!isNodeEditableVector(object)) return;
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    const path = object.paths[pathIndex];
    if (path === undefined) continue;
    for (let polylineIndex = 0; polylineIndex < path.polylines.length; polylineIndex += 1) {
      const polyline = path.polylines[polylineIndex];
      if (polyline === undefined) continue;
      for (let pointIndex = 0; pointIndex < polyline.points.length; pointIndex += 1) {
        const point = polyline.points[pointIndex];
        if (point === undefined) continue;
        drawNodeHandle(
          ctx,
          screenPoint(point, object, view),
          isSelectedNode(selectedNodes, object.id, pathIndex, polylineIndex, pointIndex),
        );
      }
    }
  }
}

function isNodeEditableVector(
  object: SceneObject,
): object is Extract<SceneObject, { readonly paths: ReadonlyArray<unknown> }> {
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') return true;
  return object.kind === 'shape' && object.spec.kind === 'polyline';
}

function drawNodeHandle(ctx: CanvasRenderingContext2D, point: Vec2, selected: boolean): void {
  const size = selected ? ACTIVE_NODE_HANDLE_PX : NODE_HANDLE_PX;
  const half = size / 2;
  ctx.fillStyle = selected ? canvasTheme.pathNodeHandleActiveFill : canvasTheme.pathNodeHandleFill;
  ctx.strokeStyle = selected
    ? canvasTheme.pathNodeHandleActiveStroke
    : canvasTheme.pathNodeHandleStroke;
  ctx.lineWidth = 1.25;
  ctx.fillRect(point.x - half, point.y - half, size, size);
  ctx.strokeRect(point.x - half, point.y - half, size, size);
}

function screenPoint(point: Vec2, object: SceneObject, view: ViewTransform): Vec2 {
  const transformed = applyTransform(point, object.transform);
  return {
    x: view.offsetX + transformed.x * view.scale,
    y: view.offsetY + transformed.y * view.scale,
  };
}

function isSelectedNode(
  selectedNodes: ReadonlyArray<PathNodeRef>,
  objectId: string,
  pathIndex: number,
  polylineIndex: number,
  pointIndex: number,
): boolean {
  return selectedNodes.some(
    (selectedNode) =>
      selectedNode.objectId === objectId &&
      selectedNode.pathIndex === pathIndex &&
      selectedNode.polylineIndex === polylineIndex &&
      selectedNode.pointIndex === pointIndex,
  );
}
