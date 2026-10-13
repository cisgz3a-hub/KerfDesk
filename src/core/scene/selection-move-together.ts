// Move H Together / Move V Together (LightBurn Distribute submenu). The units
// of the selection (see selectionUnits) are packed edge to edge along one axis
// in their current order, with no gap. The unit holding the reference object
// (the last one added to the selection) stays where it is; the others close up
// on it from either side. The other axis is left alone.

import type { AABB } from './hit-test';
import type { SceneGroup } from './scene';
import type { SceneObject } from './scene-object';
import type { SelectionTransform } from './selection-transform';
import { selectionUnits, type SelectionUnit } from './selection-units';

export type SelectionMoveTogetherAxis = 'horizontal' | 'vertical';

export type SelectionMoveTogetherEdit = {
  readonly axis: SelectionMoveTogetherAxis;
  readonly referenceId: string;
};

export type SelectionMoveTogetherResult =
  | { readonly kind: 'ok'; readonly transforms: ReadonlyArray<SelectionTransform> }
  | {
      readonly kind: 'error';
      readonly reason: 'empty-selection' | 'missing-reference' | 'not-enough-objects';
    };

export function buildSelectionMoveTogetherEdit(
  objects: ReadonlyArray<SceneObject>,
  edit: SelectionMoveTogetherEdit,
  groups: ReadonlyArray<SceneGroup> = [],
): SelectionMoveTogetherResult {
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  const units = selectionUnits(objects, groups);
  if (units.length < 2) return { kind: 'error', reason: 'not-enough-objects' };
  const reference = units.find((unit) =>
    unit.objects.some((object) => object.id === edit.referenceId),
  );
  if (reference === undefined) return { kind: 'error', reason: 'missing-reference' };
  const axis = edit.axis === 'horizontal' ? 'x' : 'y';
  const sorted = units
    .map((unit, index) => ({ unit, index }))
    .sort(
      (a, b) =>
        centre(a.unit.box, axis) - centre(b.unit.box, axis) ||
        min(a.unit.box, axis) - min(b.unit.box, axis) ||
        a.index - b.index,
    )
    .map((entry) => entry.unit);
  const at = sorted.indexOf(reference);
  const transforms: SelectionTransform[] = [];
  let edge = min(reference.box, axis);
  for (const unit of sorted.slice(0, at).reverse()) {
    transforms.push(...moveUnit(unit, axis, edge - max(unit.box, axis)));
    edge -= size(unit.box, axis);
  }
  edge = max(reference.box, axis);
  for (const unit of sorted.slice(at + 1)) {
    transforms.push(...moveUnit(unit, axis, edge - min(unit.box, axis)));
    edge += size(unit.box, axis);
  }
  return { kind: 'ok', transforms };
}

function moveUnit(
  unit: SelectionUnit,
  axis: 'x' | 'y',
  delta: number,
): ReadonlyArray<SelectionTransform> {
  if (delta === 0) return [];
  return unit.objects.map((object) => ({
    id: object.id,
    transform:
      axis === 'x'
        ? { ...object.transform, x: object.transform.x + delta }
        : { ...object.transform, y: object.transform.y + delta },
  }));
}

function min(box: AABB, axis: 'x' | 'y'): number {
  return axis === 'x' ? box.minX : box.minY;
}

function max(box: AABB, axis: 'x' | 'y'): number {
  return axis === 'x' ? box.maxX : box.maxY;
}

function size(box: AABB, axis: 'x' | 'y'): number {
  return max(box, axis) - min(box, axis);
}

function centre(box: AABB, axis: 'x' | 'y'): number {
  return (min(box, axis) + max(box, axis)) / 2;
}
