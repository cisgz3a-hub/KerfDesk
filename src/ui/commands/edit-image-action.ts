// The Image Studio entry action (ADR-242): with a raster selected it opens
// that image; without one it picks + imports an image and opens the Studio
// on it directly — the one-click Photoshop path from the main toolbar.

import type { SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import type { ToastVariant } from '../state/toast-store';
import { importImageFile } from './import-image-action';
import { pickPlatformImageFile } from './platform-image-files';

export function editImageAction(
  platform: PlatformAdapter,
  selected: SceneObject | null,
  importRasterImage: (object: SceneObject) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): () => void {
  return () => {
    if (selected?.kind === 'raster-image') {
      useImageEditorStore.getState().openEditor(selected);
      return;
    }
    void pickPlatformImageFile(platform)
      .then((file) => {
        if (file === null) return null;
        return importImageFile(file, importRasterImage, pushToast);
      })
      .then((imported) => {
        if (imported?.kind === 'raster-image') {
          useImageEditorStore.getState().openEditor(imported);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        pushToast(`Could not open an image to edit: ${message}`, 'error');
      });
  };
}
