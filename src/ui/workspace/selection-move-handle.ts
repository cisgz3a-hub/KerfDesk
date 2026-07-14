import { combinedBBox, type SceneObject, type Vec2 } from '../../core/scene';

export const SELECTION_MOVE_HANDLE_SCREEN_PX = 14;

export function selectionMoveHandlePosition(objects: ReadonlyArray<SceneObject>): Vec2 | null {
  const bounds = combinedBBox(objects);
  if (bounds === null) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function hitSelectionMoveHandle(
  objects: ReadonlyArray<SceneObject>,
  point: Vec2,
  pxToMm: number,
): boolean {
  const position = selectionMoveHandlePosition(objects);
  if (position === null) return false;
  const halfMm = (SELECTION_MOVE_HANDLE_SCREEN_PX / 2) * pxToMm;
  return Math.abs(point.x - position.x) <= halfMm && Math.abs(point.y - position.y) <= halfMm;
}
