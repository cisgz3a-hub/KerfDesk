// What a click on the workspace picks follows what the view shows: Wireframe
// outlines Fill artwork (ADR-410), so its interiors let clicks through as a Line
// shape's do (ADR-683 Amendment 2). The jig editor has no Wireframe, and asks
// the plain hit test.
//
// A click reaches a line by a distance on the screen, like the handles and
// the snap reach, not by millimetres of artwork (ADR-196 Amendment 1): 2 mm
// was 1.5 px on a 1300 mm bed at fit and 75 px on a 400 mm bed zoomed right in.

import {
  DEFAULT_STROKE_HIT_TOLERANCE_MM,
  hitTestDetailed,
  type Scene,
  type SceneHit,
  type Vec2,
} from '../../core/scene';
import { hitTestCandidates } from '../../core/scene/hit-test-candidates';
import { useUiStore } from '../state/ui-store';

/** How near a line a click must land to pick it, in canvas pixels. */
export const STROKE_PICK_SCREEN_PX = 5;

/** The pick reach in scene millimetres at this zoom (`pxToMm`: millimetres per canvas pixel). */
export function strokePickToleranceMm(pxToMm: number): number {
  return Number.isFinite(pxToMm) && pxToMm > 0
    ? STROKE_PICK_SCREEN_PX * pxToMm
    : DEFAULT_STROKE_HIT_TOLERANCE_MM;
}

/** The object under the point and whether it was hit directly or by its interior. */
export function workspacePick(
  scene: Scene,
  point: Vec2,
  pxToMm: number,
  options: { readonly includeLocked?: boolean } = {},
): SceneHit | null {
  return hitTestDetailed(scene, point, {
    ...options,
    wireframe: useUiStore.getState().wireframeView,
    strokeToleranceMm: strokePickToleranceMm(pxToMm),
  });
}

export function workspaceHitTest(
  scene: Scene,
  point: Vec2,
  pxToMm: number,
  options: { readonly includeLocked?: boolean } = {},
): string | null {
  return workspacePick(scene, point, pxToMm, options)?.id ?? null;
}

export function workspaceHitTestCandidates(
  scene: Scene,
  point: Vec2,
  pxToMm: number,
): ReadonlyArray<string> {
  return hitTestCandidates(scene, point, {
    wireframe: useUiStore.getState().wireframeView,
    strokeToleranceMm: strokePickToleranceMm(pxToMm),
  });
}
