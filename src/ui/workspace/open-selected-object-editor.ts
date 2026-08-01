// Double-click on a selected object opens its in-place editor: a raster
// image opens in the Image Studio (Photoshop's double-click-to-edit — the
// toolbar "Image Studio…" button is the other entry point), a text object
// opens the text dialog pre-populated with its current values. Every other
// kind is a no-op.

import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useImageEditorStore } from '../image-editor/image-editor-store';

export function openEditorForSelectedObject(): void {
  const s = useStore.getState();
  const id = s.selectedObjectId;
  if (id === null) return;
  const obj = s.project.scene.objects.find((object) => object.id === id);
  if (obj === undefined) return;
  if (obj.kind === 'raster-image') {
    useImageEditorStore.getState().openEditor(obj);
    return;
  }
  if (obj.kind !== 'text') return;
  useUiStore.getState().openTextDialog({
    mode: 'edit',
    id: obj.id,
    content: obj.content,
    fontKey: obj.fontKey,
    sizeMm: obj.sizeMm,
    alignment: obj.alignment,
    lineHeight: obj.lineHeight,
    letterSpacing: obj.letterSpacing,
    bendDeg: obj.bendDeg ?? 0,
    ...(obj.pathText === undefined ? {} : { pathText: obj.pathText }),
    ...(obj.variableTemplate === undefined ? {} : { variableTemplate: obj.variableTemplate }),
    color: obj.color,
  });
}
