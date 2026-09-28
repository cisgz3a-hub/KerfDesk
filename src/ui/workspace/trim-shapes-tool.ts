// The Trim Shapes tool on the canvas (LightBurn gap LBG-T04). Hovering asks
// the core which stretch of outline a click would delete; the scene's
// flattened outlines and crossings are kept per scene, so the highlight
// follows the pointer without redoing that work. A click deletes the stretch
// through the store, one undo step each.

import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  createTrimSession,
  findTrimTarget,
  type TrimSession,
  type TrimTarget,
} from '../../core/geometry/trim-shapes';
import type { Project, Scene, Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';

// Canvas bitmap pixels, like the laser tab tool's placement tolerance.
export const TRIM_PICK_TOLERANCE_PX = 8;

const sessions = new WeakMap<Scene, TrimSession>();

/** The stretch under `point`, reusing the scene's outlines between pointer moves. */
export function trimHoverTarget(scene: Scene, point: Vec2, toleranceMm: number): TrimTarget | null {
  let session = sessions.get(scene);
  if (session === undefined) {
    session = createTrimSession(scene);
    sessions.set(scene, session);
  }
  return findTrimTarget(scene, point, toleranceMm, session);
}

/** A primary click with the tool on: delete the stretch under the pointer, if any. */
export function trimAtPointer(args: {
  readonly e: ReactMouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
}): void {
  const point = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
  if (point === null) return;
  const pxToMm = pxToMmForCanvas(args.canvas, args.project, args.viewState);
  useStore.getState().trimShapeAt(point, TRIM_PICK_TOLERANCE_PX * pxToMm);
}
