import {
  applyTransform,
  curveControlPoint,
  curveNodeCount,
  curveNodePoint,
  type ColoredPath,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
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
  const objectSelection = selectedNodes.filter((node) => node.objectId === object.id);
  const selected = new Set(objectSelection.map(nodeKey));
  const selectedCurves = new Set(
    objectSelection.filter((node) => node.geometry === 'curve').map(nodeKey),
  );
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    const path = object.paths[pathIndex];
    if (path === undefined) continue;
    if (path.curves !== undefined) {
      drawCurvePathHandles(ctx, object, path, pathIndex, view, selectedCurves);
      continue;
    }
    for (let polylineIndex = 0; polylineIndex < path.polylines.length; polylineIndex += 1) {
      const polyline = path.polylines[polylineIndex];
      if (polyline === undefined) continue;
      for (let pointIndex = 0; pointIndex < polyline.points.length; pointIndex += 1) {
        const point = polyline.points[pointIndex];
        if (point === undefined) continue;
        drawNodeHandle(
          ctx,
          screenPoint(point, object, view),
          nodeSelected(selected, { pathIndex, polylineIndex, pointIndex }),
        );
      }
    }
  }
}

function drawCurvePathHandles(
  ctx: CanvasRenderingContext2D,
  object: SceneObject,
  path: ColoredPath,
  pathIndex: number,
  view: ViewTransform,
  selectedNodes: ReadonlySet<string>,
): void {
  for (let curveIndex = 0; curveIndex < (path.curves?.length ?? 0); curveIndex += 1) {
    const curve = path.curves?.[curveIndex];
    if (curve === undefined) continue;
    for (let nodeIndex = 0; nodeIndex < curveNodeCount(curve); nodeIndex += 1) {
      const anchor = curveNodePoint(curve, nodeIndex);
      if (anchor === null) continue;
      const ref: PathNodeRef = {
        objectId: object.id,
        pathIndex,
        polylineIndex: curveIndex,
        pointIndex: nodeIndex,
        geometry: 'curve',
      };
      const selected = nodeSelected(selectedNodes, ref);
      drawNodeHandle(ctx, screenPoint(anchor, object, view), selected);
      if (selected) drawCurveControls(ctx, object, curve, ref, view);
    }
  }
}

function drawCurveControls(
  ctx: CanvasRenderingContext2D,
  object: SceneObject,
  curve: NonNullable<ColoredPath['curves']>[number],
  anchorRef: PathNodeRef,
  view: ViewTransform,
): void {
  const anchor = curveNodePoint(curve, anchorRef.pointIndex);
  if (anchor === null) return;
  const anchorScreen = screenPoint(anchor, object, view);
  for (const side of ['incoming', 'outgoing'] as const) {
    const control = curveControlPoint(curve, anchorRef.pointIndex, side);
    if (control === null) continue;
    const controlScreen = screenPoint(control, object, view);
    ctx.strokeStyle = canvasTheme.pathNodeHandleStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(anchorScreen.x, anchorScreen.y);
    ctx.lineTo(controlScreen.x, controlScreen.y);
    ctx.stroke();
    drawControlHandle(ctx, controlScreen);
  }
}

function drawControlHandle(ctx: CanvasRenderingContext2D, point: Vec2): void {
  const size = 5;
  const half = size / 2;
  if (!handleOnCanvas(ctx, point, half)) return;
  ctx.fillStyle = canvasTheme.pathNodeHandleFill;
  ctx.strokeStyle = canvasTheme.pathNodeHandleStroke;
  ctx.fillRect(point.x - half, point.y - half, size, size);
  ctx.strokeRect(point.x - half, point.y - half, size, size);
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
  if (!handleOnCanvas(ctx, point, half)) return;
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

function handleOnCanvas(ctx: CanvasRenderingContext2D, point: Vec2, half: number): boolean {
  const width = ctx.canvas?.width ?? Number.POSITIVE_INFINITY;
  const height = ctx.canvas?.height ?? Number.POSITIVE_INFINITY;
  const margin = half + 1;
  return (
    point.x >= -margin &&
    point.y >= -margin &&
    point.x <= width + margin &&
    point.y <= height + margin
  );
}

function nodeKey(ref: Pick<PathNodeRef, 'pathIndex' | 'polylineIndex' | 'pointIndex'>): string {
  return `${ref.pathIndex}:${ref.polylineIndex}:${ref.pointIndex}`;
}

function nodeSelected(
  selected: ReadonlySet<string>,
  ref: Pick<PathNodeRef, 'pathIndex' | 'polylineIndex' | 'pointIndex'>,
): boolean {
  return selected.size > 0 && selected.has(nodeKey(ref));
}
