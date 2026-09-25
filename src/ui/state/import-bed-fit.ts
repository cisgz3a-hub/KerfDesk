// applyImportBedFit — the scale-to-fit half of a fresh import. applyFreshImport
// places artwork at its file size; only art larger than the bed in either axis
// is then shrunk here, so a 1000 mm SVG dropped on a 400 mm bed does not
// vanish off the corner. The file-size placement is pushed to history first,
// so one Undo restores the original size and a second removes the import. The
// returned outcome carries the fit so the import notice can say what changed.

import { combinedBBox, type SceneObject } from '../../core/scene';
import { measureBoundsBedFit } from '../../core/scene/fit-to-bed';
import { pushUndo, type ImportOutcome, type MutationResult } from './scene-mutations';

type ImportPlacement = Pick<MutationResult, 'project' | 'undoStack'> & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
};

export function applyImportBedFit<T extends ImportPlacement>(
  placed: T,
): { readonly state: T; readonly outcome: ImportOutcome } {
  const { project } = placed;
  // A composed SVG selects every component in one atomic import. Fit the
  // union with one world-space scale so registration and clips stay aligned.
  const ids = new Set([placed.selectedObjectId, ...(placed.additionalSelectedIds ?? [])]);
  const objects = project.scene.objects.filter((object) => ids.has(object.id));
  const footprint = combinedBBox(objects);
  if (footprint === null || objects.some(keepsAuthoredScale)) {
    return { state: placed, outcome: { kind: 'added' } };
  }
  const bedFit = measureBoundsBedFit(footprint, project.device.bedWidth, project.device.bedHeight);
  if (bedFit.scale >= 1) return { state: placed, outcome: { kind: 'added' } };
  const centerX = (footprint.minX + footprint.maxX) / 2;
  const centerY = (footprint.minY + footprint.maxY) / 2;
  const scaled = project.scene.objects.map((object) =>
    !ids.has(object.id)
      ? object
      : {
          ...object,
          transform: {
            ...object.transform,
            x: centerX + bedFit.scale * (object.transform.x - centerX),
            y: centerY + bedFit.scale * (object.transform.y - centerY),
            scaleX: object.transform.scaleX * bedFit.scale,
            scaleY: object.transform.scaleY * bedFit.scale,
          },
        },
  );
  return {
    state: {
      ...placed,
      project: { ...project, scene: { ...project.scene, objects: scaled } },
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
