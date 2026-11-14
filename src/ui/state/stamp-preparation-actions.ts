import {
  addLayer,
  addObject,
  createArtworkOperation,
  primaryOperationForObject,
  type Project,
  type RasterImage,
  type Scene,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/effective-output';
import { withObjectsOutputOff } from '../../core/scene/reference-image-output';
import { stampSourceSelection } from '../raster/stamp-source-selection';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './undo-stack';
import type { AppState } from './store';
import type { PreparedStampSource } from '../raster/stamp-source';
import type { StampEncodedDraft } from '../raster/stamp-worker-protocol';

export type StampOwner = {
  readonly project: Project;
  readonly documentEpoch: number;
  readonly ids: readonly string[];
};
export function stampOwnerIsCurrent(state: AppState, owner: StampOwner): boolean {
  const ids = selectedObjectIds(state);
  return (
    state.project === owner.project &&
    state.projectDocumentEpoch === owner.documentEpoch &&
    ids.length === owner.ids.length &&
    owner.ids.every((id) => ids.includes(id))
  );
}
export function stampDraftImage(
  source: PreparedStampSource,
  draft: StampEncodedDraft,
  id: string,
): RasterImage {
  const image = source.image;
  const localPitchX = (image.bounds.maxX - image.bounds.minX) / image.pixelWidth;
  const localPitchY = (image.bounds.maxY - image.bounds.minY) / image.pixelHeight;
  return {
    kind: 'raster-image',
    id,
    source: `${image.source} (stamp height intent)`,
    dataUrl: draft.dataUrl,
    lumaBase64: draft.lumaBase64,
    pixelWidth: draft.width,
    pixelHeight: draft.height,
    bounds: {
      minX: image.bounds.minX - draft.paddingX * localPitchX,
      minY: image.bounds.minY - draft.paddingY * localPitchY,
      maxX: image.bounds.maxX + draft.paddingX * localPitchX,
      maxY: image.bounds.maxY + draft.paddingY * localPitchY,
    },
    transform: image.transform,
    color: image.color,
    // Grayscale burns each pixel at a power that follows its height, so the
    // shoulder slopes as the preview shows instead of dithering into
    // full-power dots (T32-P3-1). The face is white and burns at 0.
    dither: 'grayscale',
    linesPerMm: image.linesPerMm,
  };
}
/** Add a fresh image through the existing artwork operation allocator. Source
 * objects, groups and pixels retain their exact identities, but they stop
 * burning: left on, they would engrave the raised face the stamp leaves
 * standing (ADR-570 Amendment 3, tools audit T32-P1-1). Undo restores them. */
export function applyStampDraft(
  state: AppState,
  owner: StampOwner,
  image: RasterImage,
): Partial<AppState> {
  if (
    !stampOwnerIsCurrent(state, owner) ||
    state.project.scene.objects.some((object) => object.id === image.id)
  )
    return {};
  const created = createArtworkOperation(state.project.scene, image, {
    mode: 'image',
    name: 'Stamp height intent',
  });
  const sourceIds = stampSourceSelection(state.project.scene, owner.ids).objects.map(
    (object) => object.id,
  );
  const withStamp = addLayer(addObject(state.project.scene, created.object), {
    ...created.operation,
    ditherAlgorithm: image.dither,
    linesPerMm: stampLinesPerMm(state.project.scene, sourceIds, image),
  });
  const scene = withObjectsOutputOff(withStamp, sourceIds, {
    copyName: (operation) => `${operation.name} (stamp source)`,
  });
  return {
    project: { ...state.project, scene },
    selectedObjectId: image.id,
    additionalSelectedIds: new Set(),
    undoStack: pushUndo(state.project, state.undoStack, 'Prepare stamp image'),
    redoStack: [],
    dirty: true,
  };
}

/** The toast for an applied stamp; `skipped` names what the stamp left out. */
export function stampAppliedNotice(skipped: string): string {
  const applied =
    'Stamp added on "Stamp height intent", source kept with Output off so it cannot burn the raised face. Undo brings it back.';
  return skipped === '' ? applied : `${applied} ${skipped}`;
}

// A photo's stamp burns at the rows its own Image operation burns, not the
// import-time lines/mm stored on the photo (rolling v3 H5-P3-3). Vector
// stamps keep the dialog's DPI, which the new image already carries.
function stampLinesPerMm(scene: Scene, sourceIds: readonly string[], image: RasterImage): number {
  const source = scene.objects.find((object) => object.id === sourceIds[0]);
  if (sourceIds.length !== 1 || source?.kind !== 'raster-image') return image.linesPerMm;
  const operation = primaryOperationForObject(source, scene.layers);
  if (operation === null) return image.linesPerMm;
  const effective = effectiveOperationForObject(operation, source);
  return effective.mode === 'image' ? effective.linesPerMm : image.linesPerMm;
}
