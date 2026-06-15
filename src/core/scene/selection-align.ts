import { transformedBBox, type AABB } from './hit-test';
import type { SceneObject, Transform } from './scene-object';
import type { SelectionTransform } from './selection-transform';

export type SelectionAlignKind =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'centers';

export type SelectionAlignEdit = {
  readonly kind: SelectionAlignKind;
  readonly referenceId: string;
};

export type SelectionAlignError = 'empty-selection' | 'missing-reference' | 'not-enough-objects';

export type SelectionAlignResult =
  | { readonly kind: 'ok'; readonly transforms: ReadonlyArray<SelectionTransform> }
  | { readonly kind: 'error'; readonly reason: SelectionAlignError };

export function buildSelectionAlignEdit(
  objects: ReadonlyArray<SceneObject>,
  edit: SelectionAlignEdit,
): SelectionAlignResult {
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  if (objects.length < 2) return { kind: 'error', reason: 'not-enough-objects' };
  const reference = objects.find((object) => object.id === edit.referenceId);
  if (reference === undefined) return { kind: 'error', reason: 'missing-reference' };
  const referenceBox = transformedBBox(reference);
  const transforms = objects
    .filter((object) => object.id !== reference.id)
    .map((object) =>
      alignObjectToReference(object, transformedBBox(object), referenceBox, edit.kind),
    )
    .filter((item): item is SelectionTransform => item !== null);
  return { kind: 'ok', transforms };
}

function alignObjectToReference(
  object: SceneObject,
  objectBox: AABB,
  referenceBox: AABB,
  kind: SelectionAlignKind,
): SelectionTransform | null {
  const delta = alignDelta(objectBox, referenceBox, kind);
  if (delta.x === 0 && delta.y === 0) return null;
  return {
    id: object.id,
    transform: translateTransform(object.transform, delta.x, delta.y),
  };
}

function alignDelta(
  objectBox: AABB,
  referenceBox: AABB,
  kind: SelectionAlignKind,
): { readonly x: number; readonly y: number } {
  switch (kind) {
    case 'left':
      return { x: referenceBox.minX - objectBox.minX, y: 0 };
    case 'center-x':
      return { x: centerX(referenceBox) - centerX(objectBox), y: 0 };
    case 'right':
      return { x: referenceBox.maxX - objectBox.maxX, y: 0 };
    case 'top':
      return { x: 0, y: referenceBox.minY - objectBox.minY };
    case 'center-y':
      return { x: 0, y: centerY(referenceBox) - centerY(objectBox) };
    case 'bottom':
      return { x: 0, y: referenceBox.maxY - objectBox.maxY };
    case 'centers':
      return {
        x: centerX(referenceBox) - centerX(objectBox),
        y: centerY(referenceBox) - centerY(objectBox),
      };
  }
}

function translateTransform(transform: Transform, dx: number, dy: number): Transform {
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}

function centerX(box: AABB): number {
  return (box.minX + box.maxX) / 2;
}

function centerY(box: AABB): number {
  return (box.minY + box.maxY) / 2;
}
