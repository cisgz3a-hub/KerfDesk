import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../../core/effective-output';
import {
  DITHER_ALGORITHMS,
  layerFromSubLayer,
  sceneObjectHasVisibleLayer,
  sceneObjectUsesOperation,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import type { ObjectOperationSettingsOverride } from '../../core/scene/scene-object';
import type { AppState } from '../state/store';
import { pushUndo } from '../state/undo-stack';

export type PhotoEngravingOwner = {
  readonly projectDocumentEpoch: number;
  readonly image: RasterImage;
  /** The actual scene layer, before resolving this image's overrides. */
  readonly operation: Layer;
};

export type PhotoEngravingApply = {
  readonly imagePatch: {
    readonly brightness: number;
    readonly contrast: number;
    readonly gamma: number;
  };
  readonly layerPatch: Pick<
    Layer,
    'ditherAlgorithm' | 'linesPerMm' | 'negativeImage' | 'passThrough'
  >;
};

/** A delayed preview or Apply never acquires a replacement document, image or operation. */
export function photoEngravingOwnerIsCurrent(state: AppState, owner: PhotoEngravingOwner): boolean {
  const { scene } = state.project;
  const images = scene.objects.filter((object) => object.id === owner.image.id);
  const operations = scene.layers.filter((operation) => operation.id === owner.operation.id);
  return (
    (state.project.machine?.kind ?? 'laser') === 'laser' &&
    state.projectDocumentEpoch === owner.projectDocumentEpoch &&
    state.selectedObjectId === owner.image.id &&
    state.additionalSelectedIds.size === 0 &&
    images.length === 1 &&
    images[0] === owner.image &&
    operations.length === 1 &&
    operations[0] === owner.operation &&
    owner.image.locked !== true &&
    owner.image.role !== 'trace-source' &&
    sceneObjectHasVisibleLayer(scene, owner.image) &&
    sceneObjectUsesOperation(owner.image, owner.operation)
  );
}

/** The exact non-destructive image revision used by both preview and Apply. */
export function photoEngravingImage(
  image: RasterImage,
  operation: Layer,
  patch: PhotoEngravingApply,
): RasterImage {
  if (!photoEngravingPatchIsValid(patch) || matchesCurrentSettings(image, operation, patch))
    return image;
  const byOperation: Record<string, ObjectOperationSettingsOverride | null> = {
    ...image.operationOverride?.byOperation,
  };
  // A parent override normally flows into its sub-operations. Keep each
  // existing sub-pass's settings when editing only this photo operation.
  for (const subLayer of operation.subLayers) {
    const child = layerFromSubLayer(operation, subLayer);
    if (!Object.hasOwn(byOperation, child.id))
      byOperation[child.id] = operationOverrideForObject(child, image) ?? null;
  }
  byOperation[operation.id] = {
    ...operationOverrideForObject(operation, image),
    mode: 'image',
    ditherAlgorithm: patch.layerPatch.ditherAlgorithm,
    linesPerMm: patch.layerPatch.linesPerMm,
    negativeImage: patch.layerPatch.negativeImage,
    passThrough: patch.layerPatch.passThrough,
  };
  return {
    ...image,
    brightness: patch.imagePatch.brightness,
    contrast: patch.imagePatch.contrast,
    gamma: patch.imagePatch.gamma,
    operationOverride: { ...image.operationOverride, byOperation },
  };
}

/** Commit tone and image-mode settings as one Undo step, without editing a shared layer. */
export function buildPhotoEngravingUpdate(
  state: AppState,
  owner: PhotoEngravingOwner,
  patch: PhotoEngravingApply,
): Partial<AppState> | null {
  if (!photoEngravingOwnerIsCurrent(state, owner)) return null;
  const image = photoEngravingImage(owner.image, owner.operation, patch);
  if (image === owner.image) return null;
  return {
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) =>
          object === owner.image ? image : object,
        ),
      },
    },
    undoStack: pushUndo(state.project, state.undoStack, 'Photo Engraving'),
    redoStack: [],
    dirty: true,
  };
}

function matchesCurrentSettings(
  image: RasterImage,
  operation: Layer,
  patch: PhotoEngravingApply,
): boolean {
  const effective = effectiveOperationForObject(operation, image);
  return (
    (image.brightness ?? 0) === patch.imagePatch.brightness &&
    (image.contrast ?? 0) === patch.imagePatch.contrast &&
    (image.gamma ?? 1) === patch.imagePatch.gamma &&
    effective.mode === 'image' &&
    effective.ditherAlgorithm === patch.layerPatch.ditherAlgorithm &&
    effective.linesPerMm === patch.layerPatch.linesPerMm &&
    effective.negativeImage === patch.layerPatch.negativeImage &&
    effective.passThrough === patch.layerPatch.passThrough
  );
}

export function photoEngravingPatchIsValid({
  imagePatch,
  layerPatch,
}: PhotoEngravingApply): boolean {
  return (
    inRange(imagePatch.brightness, -100, 100) &&
    inRange(imagePatch.contrast, -100, 100) &&
    inRange(imagePatch.gamma, 0.1, 5) &&
    Number.isFinite(layerPatch.linesPerMm) &&
    layerPatch.linesPerMm > 0 &&
    DITHER_ALGORITHMS.includes(layerPatch.ditherAlgorithm) &&
    typeof layerPatch.negativeImage === 'boolean' &&
    typeof layerPatch.passThrough === 'boolean'
  );
}

export const isValidPhotoEngravingPatch = photoEngravingPatchIsValid;

function inRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}
