// design-fields-rect — the dimensions a rectangle exposes (ADR-271, DS-3b).

import type { SketchEntity } from '../../core/design';
import { derivedField, mmField, TAU, type EntityField } from './design-field-types';

export type RectEntity = Extract<SketchEntity, { readonly kind: 'rect' }>;

export function rectFields(entity: RectEntity): ReadonlyArray<EntityField> {
  const { widthMm, heightMm, cornerRadiusMm } = entity;
  return [
    mmField('x', 'X', entity.origin.x, 'position', { editable: true }),
    mmField('y', 'Y', entity.origin.y, 'position', { editable: true }),
    mmField('width', 'Width', widthMm, 'size', { editable: true, min: 0 }),
    mmField('height', 'Height', heightMm, 'size', { editable: true, min: 0 }),
    mmField('cornerRadius', 'Corner radius', cornerRadiusMm, 'shape', {
      editable: true,
      min: 0,
    }),
    derivedField('area', 'Area', widthMm * heightMm, 'mm2'),
    derivedField(
      'perimeter',
      'Perimeter',
      rectPerimeterMm(widthMm, heightMm, cornerRadiusMm),
      'mm',
    ),
  ];
}

// Straight runs plus the four corner quarter-arcs, which together make exactly one
// full circle of circumference at the corner radius.
export function rectPerimeterMm(widthMm: number, heightMm: number, radiusMm: number): number {
  const r = Math.min(radiusMm, widthMm / 2, heightMm / 2);
  return 2 * (widthMm - 2 * r) + 2 * (heightMm - 2 * r) + TAU * r;
}
