import type { AABB } from './hit-test';
import type { SceneGroup } from './scene';
import type { SceneObject, Transform } from './scene-object';
import type { SelectionTransform } from './selection-transform';
import { selectionUnits, type SelectionUnit } from './selection-units';

export type SelectionDistributeKind =
  | 'horizontal-centers'
  | 'horizontal-spacing'
  | 'vertical-centers'
  | 'vertical-spacing';

export type SelectionDistributeEdit = {
  readonly kind: SelectionDistributeKind;
};

export type SelectionDistributeError = 'empty-selection' | 'not-enough-objects';

export type SelectionDistributeResult =
  | { readonly kind: 'ok'; readonly transforms: ReadonlyArray<SelectionTransform> }
  | { readonly kind: 'error'; readonly reason: SelectionDistributeError };

type PositionedUnit = SelectionUnit & { readonly index: number };

/**
 * Evenly space the units of `objects` (see selectionUnits) between the two
 * outermost ones, so a selected group counts as one item and all its members
 * move by the same delta. Without `groups` every object is its own unit.
 */
export function buildSelectionDistributeEdit(
  objects: ReadonlyArray<SceneObject>,
  edit: SelectionDistributeEdit,
  groups: ReadonlyArray<SceneGroup> = [],
): SelectionDistributeResult {
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  const units = selectionUnits(objects, groups);
  if (units.length < 3) return { kind: 'error', reason: 'not-enough-objects' };

  const positioned = units.map((unit, index) => ({ ...unit, index }));
  const sorted = [...positioned].sort((a, b) => comparePositioned(a, b, edit.kind));
  const transforms = distributeSortedUnits(sorted, edit.kind).flat();
  return { kind: 'ok', transforms };
}

function distributeSortedUnits(
  sorted: ReadonlyArray<PositionedUnit>,
  kind: SelectionDistributeKind,
): ReadonlyArray<ReadonlyArray<SelectionTransform>> {
  if (isCenterKind(kind)) return distributeCenters(sorted, kind);
  return distributeEdgeSpacing(sorted, kind);
}

function distributeCenters(
  sorted: ReadonlyArray<PositionedUnit>,
  kind: SelectionDistributeKind,
): ReadonlyArray<ReadonlyArray<SelectionTransform>> {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return [];
  const axis = kind === 'horizontal-centers' ? 'x' : 'y';
  const firstCenter = centerOnAxis(first.box, axis);
  const lastCenter = centerOnAxis(last.box, axis);
  const centerStep = (lastCenter - firstCenter) / (sorted.length - 1);
  return sorted.slice(1, -1).map((item, interiorIndex) => {
    const targetCenter = firstCenter + centerStep * (interiorIndex + 1);
    const delta = targetCenter - centerOnAxis(item.box, axis);
    return distributeTransforms(item, axis, delta);
  });
}

function distributeEdgeSpacing(
  sorted: ReadonlyArray<PositionedUnit>,
  kind: SelectionDistributeKind,
): ReadonlyArray<ReadonlyArray<SelectionTransform>> {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return [];
  const axis = kind === 'horizontal-spacing' ? 'x' : 'y';
  const firstMin = minOnAxis(first.box, axis);
  const lastMax = maxOnAxis(last.box, axis);
  const totalSize = sorted.reduce((sum, item) => sum + sizeOnAxis(item.box, axis), 0);
  const gap = (lastMax - firstMin - totalSize) / (sorted.length - 1);
  let cursor = maxOnAxis(first.box, axis) + gap;
  return sorted.slice(1, -1).map((item) => {
    const delta = cursor - minOnAxis(item.box, axis);
    cursor += sizeOnAxis(item.box, axis) + gap;
    return distributeTransforms(item, axis, delta);
  });
}

function distributeTransforms(
  unit: SelectionUnit,
  axis: 'x' | 'y',
  delta: number,
): ReadonlyArray<SelectionTransform> {
  if (delta === 0) return [];
  return unit.objects.map((object) => ({
    id: object.id,
    transform: translateTransform(object.transform, axis, delta),
  }));
}

function comparePositioned(
  a: PositionedUnit,
  b: PositionedUnit,
  kind: SelectionDistributeKind,
): number {
  const axis = isHorizontalKind(kind) ? 'x' : 'y';
  const aPosition = isCenterKind(kind) ? centerOnAxis(a.box, axis) : minOnAxis(a.box, axis);
  const bPosition = isCenterKind(kind) ? centerOnAxis(b.box, axis) : minOnAxis(b.box, axis);
  return aPosition - bPosition || a.index - b.index;
}

function translateTransform(transform: Transform, axis: 'x' | 'y', delta: number): Transform {
  return axis === 'x'
    ? { ...transform, x: transform.x + delta }
    : { ...transform, y: transform.y + delta };
}

function isHorizontalKind(kind: SelectionDistributeKind): boolean {
  return kind === 'horizontal-centers' || kind === 'horizontal-spacing';
}

function isCenterKind(kind: SelectionDistributeKind): boolean {
  return kind === 'horizontal-centers' || kind === 'vertical-centers';
}

function minOnAxis(box: AABB, axis: 'x' | 'y'): number {
  return axis === 'x' ? box.minX : box.minY;
}

function maxOnAxis(box: AABB, axis: 'x' | 'y'): number {
  return axis === 'x' ? box.maxX : box.maxY;
}

function sizeOnAxis(box: AABB, axis: 'x' | 'y'): number {
  return maxOnAxis(box, axis) - minOnAxis(box, axis);
}

function centerOnAxis(box: AABB, axis: 'x' | 'y'): number {
  return (minOnAxis(box, axis) + maxOnAxis(box, axis)) / 2;
}
