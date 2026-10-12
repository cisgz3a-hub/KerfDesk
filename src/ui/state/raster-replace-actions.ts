// Replace the picture of a placed image in one undo step (LightBurn Replace
// Image / Replace to Fit / Refresh). The incoming image comes from the
// ordinary image import, so it is decoded, sampled and stored exactly as a
// fresh import would be; only its picture fields move onto the placed image.

import { replaceRasterPicture, type RasterReplaceMode } from '../../core/scene/raster-replace';
import type { SceneObject } from '../../core/scene';
import { pushUndo } from './undo-stack';
import type { AppState } from './store';

export type RasterReplaceActions = {
  /** False when the target is gone, locked or no longer an image. */
  readonly replaceRasterImage: (
    targetId: string,
    incoming: SceneObject,
    mode: RasterReplaceMode,
  ) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function rasterReplaceActions(set: Setter): RasterReplaceActions {
  return {
    replaceRasterImage: (targetId, incoming, mode) => {
      let replaced = false;
      set((state) => {
        const target = state.project.scene.objects.find((object) => object.id === targetId);
        if (target?.kind !== 'raster-image' || target.locked === true) return state;
        if (incoming.kind !== 'raster-image') return state;
        const next = replaceRasterPicture(target, incoming, mode);
        replaced = true;
        return {
          project: {
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) =>
                object.id === targetId ? next : object,
              ),
            },
          },
          undoStack: pushUndo(state.project, state.undoStack, 'Replace image'),
          redoStack: [],
          dirty: true,
        };
      });
      return replaced;
    },
  };
}
