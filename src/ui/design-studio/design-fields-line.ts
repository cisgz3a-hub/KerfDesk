// design-fields-line — the dimensions a line exposes (ADR-271, DS-3b).
//
// Both endpoints AND length/angle are editable: Cartesian for placing a line
// against known coordinates, polar for "50 mm at 30 degrees". They describe the
// same two points, so editing either updates the other.

import type { SketchEntity } from '../../core/design';
import { degField, mmField, RAD_TO_DEG, type EntityField } from './design-field-types';

export type LineEntity = Extract<SketchEntity, { readonly kind: 'line' }>;

export function lineFields(entity: LineEntity): ReadonlyArray<EntityField> {
  const dx = entity.end.x - entity.start.x;
  const dy = entity.end.y - entity.start.y;
  const deg = Math.atan2(dy, dx) * RAD_TO_DEG;
  return [
    mmField('startX', 'Start X', entity.start.x, 'position', { editable: true }),
    mmField('startY', 'Start Y', entity.start.y, 'position', { editable: true }),
    mmField('endX', 'End X', entity.end.x, 'position', { editable: true }),
    mmField('endY', 'End Y', entity.end.y, 'position', { editable: true }),
    mmField('length', 'Length', Math.hypot(dx, dy), 'size', { editable: true, min: 0 }),
    degField('angle', 'Angle', deg < 0 ? deg + 360 : deg, true),
  ];
}
