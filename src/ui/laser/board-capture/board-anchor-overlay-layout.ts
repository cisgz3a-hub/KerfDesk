import type { AABB } from '../../../core/scene';
import type {
  BoardVerificationTarget,
  CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import type { ViewTransform } from '../../workspace/view-transform';

export type BoardAnchorOverlayHandle = {
  readonly target: BoardVerificationTarget;
  readonly label: string;
  readonly scenePoint: { readonly x: number; readonly y: number };
};

/**
 * Places named verification handles on the captured board outline in scene space.
 * These are display coordinates only: callers pass the target identity to motion
 * code, which derives the physical machine point from CapturedBoardGeometry.
 */
export function boardAnchorOverlayHandles(
  kind: CapturedBoardGeometry['kind'],
  bounds: AABB,
): ReadonlyArray<BoardAnchorOverlayHandle> {
  return kind === 'rect' ? rectangleHandles(bounds) : circleHandles(bounds);
}

export function scenePointToOverlayPosition(
  point: { readonly x: number; readonly y: number },
  view: ViewTransform,
): { readonly left: number; readonly top: number } {
  return {
    left: view.offsetX + point.x * view.scale,
    top: view.offsetY + point.y * view.scale,
  };
}

export function boardAnchorOverlayHasCollision(
  handles: ReadonlyArray<BoardAnchorOverlayHandle>,
  view: ViewTransform,
  hitAreaPx = 44,
): boolean {
  const positions = handles.map((handle) => scenePointToOverlayPosition(handle.scenePoint, view));
  for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
    const left = positions[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
      const right = positions[rightIndex];
      if (
        right !== undefined &&
        Math.abs(left.left - right.left) <= hitAreaPx &&
        Math.abs(left.top - right.top) <= hitAreaPx
      ) {
        return true;
      }
    }
  }
  return false;
}

function rectangleHandles(bounds: AABB): ReadonlyArray<BoardAnchorOverlayHandle> {
  return [
    rectangleHandle('bottom-left', 'Verify board bottom-left corner', bounds.minX, bounds.maxY),
    rectangleHandle('bottom-right', 'Verify board bottom-right corner', bounds.maxX, bounds.maxY),
    rectangleHandle('top-left', 'Verify board top-left corner', bounds.minX, bounds.minY),
    rectangleHandle('top-right', 'Verify board top-right corner', bounds.maxX, bounds.minY),
  ];
}

function circleHandles(bounds: AABB): ReadonlyArray<BoardAnchorOverlayHandle> {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return [
    circleHandle('center', 'Verify board center', centerX, centerY),
    circleHandle('rim-top', 'Verify board top rim', centerX, bounds.minY),
    circleHandle('rim-right', 'Verify board right rim', bounds.maxX, centerY),
    circleHandle('rim-bottom', 'Verify board bottom rim', centerX, bounds.maxY),
    circleHandle('rim-left', 'Verify board left rim', bounds.minX, centerY),
  ];
}

function rectangleHandle(
  anchor: Extract<BoardVerificationTarget, { readonly kind: 'rect' }>['anchor'],
  label: string,
  x: number,
  y: number,
): BoardAnchorOverlayHandle {
  return { target: { kind: 'rect', anchor }, label, scenePoint: { x, y } };
}

function circleHandle(
  anchor: Extract<BoardVerificationTarget, { readonly kind: 'circle' }>['anchor'],
  label: string,
  x: number,
  y: number,
): BoardAnchorOverlayHandle {
  return { target: { kind: 'circle', anchor }, label, scenePoint: { x, y } };
}
