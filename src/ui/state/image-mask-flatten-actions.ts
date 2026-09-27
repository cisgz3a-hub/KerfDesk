// Flatten Image Mask (LightBurn gap batch 5, LBG-I04, ADR-480): Crop Image's
// bake-and-crop, then the mask shape goes too, as in LightBurn, so only the
// image in the shape of its mask remains. The mask shape stays when the user
// locked it or another image or text still uses it. One undo step.

import { replaceObject, type RasterImage, type Scene } from '../../core/scene';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type FlattenImageMaskOutcome = 'mask-deleted' | 'mask-kept' | 'unchanged';

export type ImageMaskFlattenActions = {
  readonly flattenImageMask: (imageId: string, flattened: RasterImage) => FlattenImageMaskOutcome;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function imageMaskFlattenActions(set: Setter): ImageMaskFlattenActions {
  return {
    flattenImageMask: (imageId, flattened) => {
      let outcome: FlattenImageMaskOutcome = 'unchanged';
      set((state) => {
        const image = state.project.scene.objects.find((object) => object.id === imageId);
        if (image?.kind !== 'raster-image' || image.imageMaskId === undefined) return state;
        const maskId = image.imageMaskId;
        const { imageMaskId: _mask, ...baked } = { ...flattened, id: image.id };
        let scene = replaceObject(state.project.scene, image.id, baked);
        const deletable = maskIsDeletable(scene, maskId);
        if (deletable) scene = withoutObject(scene, maskId);
        outcome = deletable ? 'mask-deleted' : 'mask-kept';
        return {
          project: { ...state.project, scene },
          selectedObjectId: image.id,
          additionalSelectedIds: new Set(),
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
      return outcome;
    },
  };
}

function maskIsDeletable(scene: Scene, maskId: string): boolean {
  const mask = scene.objects.find((object) => object.id === maskId);
  if (mask === undefined || mask.locked === true) return false;
  return !scene.objects.some(
    (object) =>
      (object.kind === 'raster-image' && object.imageMaskId === maskId) ||
      (object.kind === 'text' && object.pathText?.guideObjectId === maskId),
  );
}

function withoutObject(scene: Scene, id: string): Scene {
  const kept: Scene = {
    ...scene,
    objects: scene.objects.filter((object) => object.id !== id),
    ...(scene.artworkOrder === undefined
      ? {}
      : { artworkOrder: scene.artworkOrder.filter((entry) => entry !== id) }),
  };
  return pruneOrphanLayers(removeObjectIdsFromGroups(kept, new Set([id])));
}
