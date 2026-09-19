// Double-click on a selected object opens its in-place editor: a raster
// image opens in the Image Studio (Photoshop's double-click-to-edit — the
// toolbar "Image Studio…" button is the other entry point), a text object
// opens the canvas text editor with its current values. Every other
// kind is a no-op.

import { useStore } from '../state';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useCanvasTextStore } from '../text/canvas-text-store';

export function openEditorForSelectedObject(): void {
  const s = useStore.getState();
  if (s.previewMode || isModalOpen(useUiStore.getState())) return;
  const id = s.selectedObjectId;
  if (id === null) return;
  const obj = s.project.scene.objects.find((object) => object.id === id);
  if (obj === undefined || obj.locked === true) return;
  if (obj.kind === 'raster-image') {
    useImageEditorStore.getState().openEditor(obj);
    return;
  }
  if (obj.kind !== 'text') return;
  useCanvasTextStore.getState().beginEdit(obj);
}
