// Move laser to selection (LightBurn gap LBG-T15, ADR-493). The anchor of the
// selection's world bounds is a canvas point, so the head goes where an
// Absolute job burns it. In User Origin, Verified Origin and Current Position
// the job is placed from the origin when it is prepared, so a canvas point has
// no fixed spot on the machine until then; the toast says so and points at
// Frame, which traces where the prepared job will burn.

import {
  combinedBBox,
  selectionAnchorPoint,
  type Project,
  type SelectionAnchor,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';
import { dispatchHeadMove } from './head-move-dispatch';

export const MOVE_TO_SELECTION_NEEDS_SELECTION = 'Select artwork to move the laser to.';
export const MOVE_TO_SELECTION_NEEDS_ABSOLUTE =
  'Move laser to selection follows the canvas, which is where the job burns in Absolute Coords. In User Origin, Verified Origin and Current Position the job is placed from the origin, so use Frame to see where it will burn.';

/** The canvas point of a selection anchor, or null with nothing selected. */
export function selectionAnchorScenePoint(
  project: Project,
  ids: ReadonlyArray<string>,
  anchor: SelectionAnchor,
): Vec2 | null {
  const selected = new Set(ids);
  const bbox = combinedBBox(project.scene.objects.filter((object) => selected.has(object.id)));
  return bbox === null ? null : selectionAnchorPoint(bbox, anchor);
}

export function moveLaserToSelection(anchor: SelectionAnchor): void {
  const app = useStore.getState();
  const toast = useToastStore.getState().pushToast;
  const point = selectionAnchorScenePoint(app.project, selectedObjectIds(app), anchor);
  if (point === null) {
    toast(MOVE_TO_SELECTION_NEEDS_SELECTION, 'error');
    return;
  }
  if (app.jobPlacement.startFrom !== 'absolute') {
    toast(MOVE_TO_SELECTION_NEEDS_ABSOLUTE, 'warning');
    return;
  }
  dispatchHeadMove({ frame: 'bed', xMm: point.x, yMm: point.y }, 'the selection');
}
