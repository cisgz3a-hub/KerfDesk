import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  createExtendModel,
  findExtendTarget,
  type ExtendTarget,
} from '../../core/geometry/extend-shapes';
import type { Project, Scene, Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';

export const EXTEND_PICK_TOLERANCE_PX = 8;
const models = new WeakMap<Scene, ReturnType<typeof createExtendModel>>();

export function extendHoverTarget(
  scene: Scene,
  point: Vec2,
  toleranceMm: number,
): ExtendTarget | null {
  let model = models.get(scene);
  if (model === undefined) {
    model = createExtendModel(scene);
    models.set(scene, model);
  }
  return findExtendTarget(model, point, toleranceMm);
}

export function extendAtPointer(args: {
  readonly e: ReactMouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
}): void {
  const point = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
  if (point === null) return;
  const pxToMm = pxToMmForCanvas(args.canvas, args.project, args.viewState);
  useStore.getState().extendShapeAt(point, EXTEND_PICK_TOLERANCE_PX * pxToMm);
}

export function extendStatusMessage(status: ExtendTarget['status']): string {
  switch (status) {
    case 'ready':
      return 'Click to extend to the highlighted boundary. Undo restores the endpoint.';
    case 'no-boundary':
      return 'No boundary ahead. This endpoint stays unchanged.';
    case 'already-touching':
      return 'This endpoint already touches a boundary.';
    case 'overlap':
      return 'This endpoint overlaps a boundary. Choose a different endpoint.';
    case 'curved-end':
      return 'This endpoint has no usable tangent.';
    case 'degenerate':
      return 'This endpoint has no usable direction.';
  }
}
