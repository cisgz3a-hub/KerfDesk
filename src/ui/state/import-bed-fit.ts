// applyImportBedFit — the scale-to-fit half of a fresh import. applyFreshImport
// places artwork at its file size; only art larger than the bed in either axis
// is then shrunk here, so a 1000 mm SVG dropped on a 400 mm bed does not
// vanish off the corner. The file-size placement is pushed to history first,
// so one Undo restores the original size and a second removes the import. The
// returned outcome carries the fit so the import notice can say what changed.
// Remote Control imports at file size and applies the same fit itself, so a
// requested position can join the fit's own step (ADR-125 Amendment 2).

import { combinedBBox, type SceneObject } from '../../core/scene';
import { measureBoundsBedFit, type BedFit } from '../../core/scene/fit-to-bed';
import { pushUndo, type ImportOutcome, type MutationResult } from './scene-mutations';

type ImportPlacement = Pick<MutationResult, 'project' | 'undoStack'> & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
};

/** `fitToBed: false` leaves oversize art at its file size for a caller that fits it itself. */
export type ImportFitOptions = { readonly fitToBed?: boolean };

export function applyImportBedFit<T extends ImportPlacement>(
  placed: T,
  options: ImportFitOptions = {},
): { readonly state: T; readonly outcome: ImportOutcome } {
  if (options.fitToBed === false) return { state: placed, outcome: { kind: 'added' } };
  const { project } = placed;
  // A composed SVG selects every component in one atomic import. Fit the
  // union with one world-space scale so registration and clips stay aligned.
  const ids = new Set([placed.selectedObjectId, ...(placed.additionalSelectedIds ?? [])]);
  const fitted = fitImportedObjectsToBed(
    project.scene.objects.filter((object) => ids.has(object.id)),
    project.device.bedWidth,
    project.device.bedHeight,
  );
  if (fitted === null) return { state: placed, outcome: { kind: 'added' } };
  const byId = new Map(fitted.objects.map((object) => [object.id, object]));
  const scaled = project.scene.objects.map((object) => byId.get(object.id) ?? object);
  return {
    state: {
      ...placed,
      project: { ...project, scene: { ...project.scene, objects: scaled } },
      undoStack: pushUndo(project, placed.undoStack),
    },
    outcome: { kind: 'added', bedFit: fitted.bedFit },
  };
}

/**
 * The import's bed fit: art larger than the bed in either axis, scaled
 * uniformly about the centre of its combined footprint into 90% of the bed
 * (ADR-125 Amendment 1). Null when it fits or keeps its authored scale.
 */
export function fitImportedObjectsToBed(
  objects: ReadonlyArray<SceneObject>,
  bedWidth: number,
  bedHeight: number,
): { readonly bedFit: BedFit; readonly objects: ReadonlyArray<SceneObject> } | null {
  const footprint = combinedBBox(objects);
  if (footprint === null || objects.some(keepsAuthoredScale)) return null;
  const bedFit = measureBoundsBedFit(footprint, bedWidth, bedHeight);
  if (bedFit.scale >= 1) return null;
  const centerX = (footprint.minX + footprint.maxX) / 2;
  const centerY = (footprint.minY + footprint.maxY) / 2;
  return {
    bedFit,
    objects: objects.map((object) => ({
      ...object,
      transform: {
        ...object.transform,
        x: centerX + bedFit.scale * (object.transform.x - centerX),
        y: centerY + bedFit.scale * (object.transform.y - centerY),
        scaleX: object.transform.scaleX * bedFit.scale,
        scaleY: object.transform.scaleY * bedFit.scale,
      },
    })),
  };
}

// An explicit depth map keeps its authored physical scale: the import toast
// and relief editor promise that width, so it is only centered and Job
// Review/Frame disclose an over-bed outline.
function keepsAuthoredScale(object: SceneObject): boolean {
  return object.kind === 'relief' && object.reliefSource.kind === 'heightfield-v1';
}
