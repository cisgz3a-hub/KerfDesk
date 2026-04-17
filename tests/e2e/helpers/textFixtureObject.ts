import { generateId, IDENTITY_MATRIX } from '../../../src/core/types';
import type { SceneObject, TextGeometry } from '../../../src/core/scene/SceneObject';

export function makeTextObject(
  layerId: string,
  tx: number,
  ty: number,
  partial: Pick<TextGeometry, 'text' | 'fontSize' | 'fontFamily'> & Partial<Omit<TextGeometry, 'type'>>,
): SceneObject {
  const geometry: TextGeometry = {
    type: 'text',
    text: partial.text,
    fontSize: partial.fontSize,
    fontFamily: partial.fontFamily,
    bold: partial.bold ?? false,
    italic: partial.italic ?? false,
  };
  return {
    id: generateId(),
    type: 'text',
    name: partial.text.slice(0, 24) || 'Text',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx, ty },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}
