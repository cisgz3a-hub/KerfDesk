// Image Studio Apply commit (ADR-242, flow F-L1 step 3).
//
// The editor bakes its RGBA working document to fresh dataUrl + luma fields
// and hands them here; the swap is exactly one project undo entry. Pixel
// dimensions and mm bounds are untouched — Studio painting never changes
// physical scale (crop/resize are separate ops with their own contracts).

import { replaceObject, type Bounds, type SceneObject } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type EditedImageFields = {
  readonly dataUrl: string;
  readonly lumaBase64: string;
  /** Present only when the edit cropped/resized (mm follows the same DPI). */
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
  readonly bounds?: Bounds;
};

export type ImageEditActions = {
  readonly applyEditedImage: (imageId: string, fields: EditedImageFields) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function imageEditActions(set: Setter): ImageEditActions {
  return {
    applyEditedImage: (imageId, fields) => set((state) => applyEdit(state, imageId, fields)),
  };
}

function applyEdit(
  state: AppState,
  imageId: string,
  fields: EditedImageFields,
): AppState | Partial<AppState> {
  const image = sceneObjectById(state.project.scene.objects, imageId);
  if (image?.kind !== 'raster-image') return state;
  const edited = {
    ...image,
    dataUrl: fields.dataUrl,
    lumaBase64: fields.lumaBase64,
    ...(fields.pixelWidth === undefined ? {} : { pixelWidth: fields.pixelWidth }),
    ...(fields.pixelHeight === undefined ? {} : { pixelHeight: fields.pixelHeight }),
    ...(fields.bounds === undefined ? {} : { bounds: fields.bounds }),
  };
  return {
    project: {
      ...state.project,
      scene: replaceObject(state.project.scene, image.id, edited),
    },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function sceneObjectById(objects: ReadonlyArray<SceneObject>, id: string): SceneObject | undefined {
  return objects.find((object) => object.id === id);
}
