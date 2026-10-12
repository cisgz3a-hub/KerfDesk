// Make Same Width / Make Same Height (LightBurn Arrange tools). Every unit of
// the selection (see selectionUnits) takes the width or height of the unit
// holding the reference object, resized about its own centre. Proportional
// keeps each unit's aspect ratio by scaling its other side to match, as
// LightBurn's Shift+click does. A unit that cannot be stretched exactly (an
// obliquely rotated object would need shear) is skipped and counted.

import type { SceneGroup } from './scene';
import type { SceneObject } from './scene-object';
import { buildSelectionTransformEdit, type SelectionTransform } from './selection-transform';
import { selectionUnits } from './selection-units';

export type SelectionMatchSizeKind = 'width' | 'height';

export type SelectionMatchSizeEdit = {
  readonly kind: SelectionMatchSizeKind;
  readonly referenceId: string;
  readonly proportional: boolean;
};

export type SelectionMatchSizeError =
  | 'empty-selection'
  | 'missing-reference'
  | 'not-enough-objects'
  | 'degenerate-reference';

export type SelectionMatchSizeResult =
  | {
      readonly kind: 'ok';
      readonly transforms: ReadonlyArray<SelectionTransform>;
      readonly skipped: number;
    }
  | { readonly kind: 'error'; readonly reason: SelectionMatchSizeError };

const MIN_DIMENSION_MM = 0.000001;

export function buildSelectionMatchSizeEdit(
  objects: ReadonlyArray<SceneObject>,
  edit: SelectionMatchSizeEdit,
  groups: ReadonlyArray<SceneGroup> = [],
): SelectionMatchSizeResult {
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  const units = selectionUnits(objects, groups);
  if (units.length < 2) return { kind: 'error', reason: 'not-enough-objects' };
  const reference = units.find((unit) =>
    unit.objects.some((object) => object.id === edit.referenceId),
  );
  if (reference === undefined) return { kind: 'error', reason: 'missing-reference' };
  const target =
    edit.kind === 'width'
      ? reference.box.maxX - reference.box.minX
      : reference.box.maxY - reference.box.minY;
  if (!(target > MIN_DIMENSION_MM)) return { kind: 'error', reason: 'degenerate-reference' };
  const transforms: SelectionTransform[] = [];
  let skipped = 0;
  for (const unit of units) {
    if (unit === reference) continue;
    const result = buildSelectionTransformEdit(unit.objects, {
      kind: 'resize',
      anchor: 'c',
      ...(edit.kind === 'width' ? { width: target } : { height: target }),
      preserveAspect: edit.proportional,
    });
    if (result.kind === 'ok') transforms.push(...result.transforms);
    else skipped += 1;
  }
  return { kind: 'ok', transforms, skipped };
}
