import {
  addLayer,
  addObject,
  createArtworkOperation,
  type Project,
  type RasterImage,
} from '../../core/scene';
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
    dither: 'floyd-steinberg',
    linesPerMm: image.linesPerMm,
  };
}
/** Add a fresh image through the existing artwork operation allocator. Source
 * objects, settings, groups and pixels retain their exact identities. */
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
  const scene = addLayer(addObject(state.project.scene, created.object), {
    ...created.operation,
    linesPerMm: image.linesPerMm,
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
