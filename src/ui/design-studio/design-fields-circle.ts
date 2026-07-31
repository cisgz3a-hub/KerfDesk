// design-fields-circle — the dimensions a circle exposes (ADR-271, DS-3b).
//
// Radius AND diameter are both shown and both editable, because a hole is
// specified by diameter and a fillet by radius; making the operator halve a number
// in their head is how a wrong hole gets cut.

import type { SketchEntity } from '../../core/design';
import { derivedField, mmField, TAU, type EntityField } from './design-field-types';

export type CircleEntity = Extract<SketchEntity, { readonly kind: 'circle' }>;

export function circleFields(entity: CircleEntity): ReadonlyArray<EntityField> {
  const r = entity.radiusMm;
  return [
    mmField('centerX', 'Centre X', entity.center.x, 'position', { editable: true }),
    mmField('centerY', 'Centre Y', entity.center.y, 'position', { editable: true }),
    mmField('radius', 'Radius', r, 'size', { editable: true, min: 0 }),
    mmField('diameter', 'Diameter', r * 2, 'size', { editable: true, min: 0 }),
    derivedField('circumference', 'Circumference', TAU * r, 'mm'),
    derivedField('area', 'Area', Math.PI * r * r, 'mm2'),
  ];
}
