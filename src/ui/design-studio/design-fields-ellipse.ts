// design-fields-ellipse — the dimensions an ellipse exposes (ADR-272
// Amendment 4).
//
// Width and height rather than the two radii, because an ellipse arrives by
// stretching a box and the operator is thinking in the size of that box — the
// same pair the rectangle inspector shows. Both radii stay reachable as derived
// readings so a number typed here is never a guess about which the field meant.

import type { SketchEntity } from '../../core/design';
import { derivedField, mmField, type EntityField } from './design-field-types';

export type EllipseEntity = Extract<SketchEntity, { readonly kind: 'ellipse' }>;

export function ellipseFields(entity: EllipseEntity): ReadonlyArray<EntityField> {
  const { radiusXMm: rx, radiusYMm: ry } = entity;
  return [
    mmField('centerX', 'Centre X', entity.center.x, 'position', { editable: true }),
    mmField('centerY', 'Centre Y', entity.center.y, 'position', { editable: true }),
    mmField('width', 'Width', rx * 2, 'size', { editable: true, min: 0 }),
    mmField('height', 'Height', ry * 2, 'size', { editable: true, min: 0 }),
    derivedField('area', 'Area', Math.PI * rx * ry, 'mm2'),
  ];
}
