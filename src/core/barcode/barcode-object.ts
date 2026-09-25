// Recognising barcode objects: a shape whose spec is a barcode. Other
// modules use this instead of repeating the two-level narrowing.

import type { SceneObject, ShapeObject } from '../scene';
import type { BarcodeShape } from '../scene/scene-object';

export type BarcodeObject = ShapeObject & { readonly spec: BarcodeShape };

export function isBarcodeObject(object: SceneObject | undefined | null): object is BarcodeObject {
  return object?.kind === 'shape' && object.spec.kind === 'barcode';
}
