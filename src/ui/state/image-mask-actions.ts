import { hasClosedImageMaskGeometry } from '../../core/raster';
import { replaceObject, type RasterImage, type SceneObject } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type ImageMaskActions = {
  readonly applyImageMask: (imageId: string, maskId: string) => void;
  readonly removeImageMask: (imageId: string) => void;
  readonly cropImage: (imageId: string, cropped: RasterImage) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function imageMaskActions(set: Setter): ImageMaskActions {
  return {
    applyImageMask: (imageId, maskId) => set((state) => applyMask(state, imageId, maskId)),
    removeImageMask: (imageId) => set((state) => removeMask(state, imageId)),
    cropImage: (imageId, cropped) => set((state) => cropMask(state, imageId, cropped)),
  };
}

function applyMask(state: AppState, imageId: string, maskId: string): AppState | Partial<AppState> {
  const image = sceneObjectById(state.project.scene.objects, imageId);
  const mask = sceneObjectById(state.project.scene.objects, maskId);
  if (image?.kind !== 'raster-image' || mask === undefined) return state;
  if (image.id === mask.id || !hasClosedImageMaskGeometry(mask)) return state;
  if (image.imageMaskId === mask.id) return state;
  const nextImage: RasterImage = { ...image, imageMaskId: mask.id };
  return {
    project: {
      ...state.project,
      scene: replaceObject(state.project.scene, image.id, nextImage),
    },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function removeMask(state: AppState, imageId: string): AppState | Partial<AppState> {
  const image = sceneObjectById(state.project.scene.objects, imageId);
  if (image?.kind !== 'raster-image' || image.imageMaskId === undefined) return state;
  const { imageMaskId: _imageMaskId, ...unmasked } = image;
  return {
    project: {
      ...state.project,
      scene: replaceObject(state.project.scene, image.id, unmasked),
    },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function cropMask(
  state: AppState,
  imageId: string,
  cropped: RasterImage,
): AppState | Partial<AppState> {
  const image = sceneObjectById(state.project.scene.objects, imageId);
  if (image?.kind !== 'raster-image' || image.imageMaskId === undefined) return state;
  const { imageMaskId: _imageMaskId, ...unmasked } =
    cropped.id === image.id ? cropped : { ...cropped, id: image.id };
  return {
    project: {
      ...state.project,
      scene: replaceObject(state.project.scene, image.id, unmasked),
    },
    selectedObjectId: image.id,
    additionalSelectedIds: new Set(),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function sceneObjectById(objects: ReadonlyArray<SceneObject>, id: string): SceneObject | undefined {
  return objects.find((object) => object.id === id);
}
