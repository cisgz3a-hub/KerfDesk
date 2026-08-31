// The Image Studio entry action (ADR-242): with a raster selected it opens
// that image; without one it picks + imports an image and opens the Studio
// on it directly — the one-click Photoshop path from the main toolbar.

import type { SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { runImagePickAction } from './image-pick-action';

export function editImageAction(
  platform: PlatformAdapter,
  selected: SceneObject | null,
  getProjectDocumentEpoch: () => number,
  importSvgObject: (object: SceneObject, batchIndex?: number) => ImportOutcome,
  importRasterImage: (object: SceneObject) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): () => void {
  const documentEpoch = getProjectDocumentEpoch();
  const documentIsCurrent = (): boolean => getProjectDocumentEpoch() === documentEpoch;
  return () => {
    if (!documentIsCurrent()) return;
    if (selected?.kind === 'raster-image') {
      useImageEditorStore.getState().openEditor(selected);
      return;
    }
    void runImagePickAction({
      platform,
      getProjectDocumentEpoch,
      importSvgObject,
      importRasterImage,
      pushToast,
    })
      .then((imported) => {
        if (documentIsCurrent() && imported?.kind === 'raster-image') {
          useImageEditorStore.getState().openEditor(imported);
        }
      })
      .catch((err: unknown) => {
        if (!documentIsCurrent()) return;
        const message = err instanceof Error ? err.message : String(err);
        pushToast(`Could not open an image to edit: ${message}`, 'error');
      });
  };
}
