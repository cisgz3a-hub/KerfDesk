import type { AABB } from './hit-test';
import type { SceneGroup } from './scene';
import type { SceneObject, Transform } from './scene-object';
import type { SelectionTransform } from './selection-transform';
import { selectionUnits, type SelectionUnit } from './selection-units';

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

/**
 * Align each unit of `objects` (see selectionUnits) to the unit that holds
 * `edit.referenceId`, so a selected group aligns by its combined bounds and all
 * its members move by the same delta. Without `groups` every object is its own
 * unit.
 */
export function buildSelectionAlignEdit(
  objects: ReadonlyArray<SceneObject>,
  edit: SelectionAlignEdit,
  groups: ReadonlyArray<SceneGroup> = [],
): SelectionAlignResult {
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  const units = selectionUnits(objects, groups);
  if (units.length < 2) return { kind: 'error', reason: 'not-enough-objects' };
  const reference = units.find((unit) =>
    unit.objects.some((object) => object.id === edit.referenceId),
  );
  if (reference === undefined) return { kind: 'error', reason: 'missing-reference' };
  const transforms = units
    .filter((unit) => unit !== reference)
    .flatMap((unit) => alignUnitToReference(unit, reference.box, edit.kind));
  return { kind: 'ok', transforms };
}

function alignUnitToReference(
  unit: SelectionUnit,
  referenceBox: AABB,
  kind: SelectionAlignKind,
): ReadonlyArray<SelectionTransform> {
  const delta = alignDelta(unit.box, referenceBox, kind);
  if (delta.x === 0 && delta.y === 0) return [];
  return unit.objects.map((object) => ({
    id: object.id,
    transform: translateTransform(object.transform, delta.x, delta.y),
  }));
}

// Exported so box-anchor alignment (board-capture, ADR-124) can compose an
// X-kind and a Y-kind into a corner snap without duplicating the min/max math.
export function alignDelta(
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
