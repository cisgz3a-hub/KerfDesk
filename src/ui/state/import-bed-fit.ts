// applyImportBedFit — the scale-to-fit half of a fresh import. applyFreshImport
// places artwork at its file size; only art larger than the bed in either axis
// is then shrunk here, so a 1000 mm SVG dropped on a 400 mm bed does not
// vanish off the corner. The file-size placement is pushed to history first,
// so one Undo restores the original size and a second removes the import. The
// returned outcome carries the fit so the import notice can say what changed.

import { replaceObject, type SceneObject } from '../../core/scene';
import { measureBedFit, scaleObjectAboutCenter } from '../../core/scene/fit-to-bed';
import { pushUndo, type ImportOutcome, type MutationResult } from './scene-mutations';

export function applyImportBedFit<T extends MutationResult>(
  placed: T,
): { readonly state: T; readonly outcome: ImportOutcome } {
  const { project } = placed;
  // A fresh import is the sole selection (F-A3), so the selection names it.
  const object = project.scene.objects.find((o) => o.id === placed.selectedObjectId);
  if (object === undefined || keepsAuthoredScale(object)) {
    return { state: placed, outcome: { kind: 'added' } };
  }
  const bedFit = measureBedFit(object, project.device.bedWidth, project.device.bedHeight);
  if (bedFit.scale >= 1) return { state: placed, outcome: { kind: 'added' } };
  const scaled = scaleObjectAboutCenter(object, bedFit.scale);
  return {
    state: {
      ...placed,
      project: { ...project, scene: replaceObject(project.scene, object.id, scaled) },
      undoStack: pushUndo(project, placed.undoStack),
    },
    outcome: { kind: 'added', bedFit },
  };
}

// An explicit depth map keeps its authored physical scale: the import toast
// and relief editor promise that width, so it is only centered and Job
// Review/Frame disclose an over-bed outline.
function keepsAuthoredScale(object: SceneObject): boolean {
  return object.kind === 'relief' && object.reliefSource.kind === 'heightfield-v1';
}
