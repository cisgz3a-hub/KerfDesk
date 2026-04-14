import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { generateId, IDENTITY_MATRIX } from '../../core/types';

export function createTextObject(
  text: string,
  x: number,
  y: number,
  layerId: string,
  fontSize: number = 10,
  fontFamily: string = 'Arial'
): SceneObject {
  const geometry: TextGeometry = {
    type: 'text',
    text,
    fontFamily,
    fontSize,
    bold: false,
    italic: false,
  };

  return {
    id: generateId(),
    type: 'text',
    name: text.substring(0, 20),
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: x, ty: y },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}
