// design-fields-arc — the dimensions an arc exposes (ADR-272, DS-3b).

import type { SketchEntity } from '../../core/design';
import {
  degField,
  derivedField,
  mmField,
  RAD_TO_DEG,
  type EntityField,
} from './design-field-types';

export type ArcEntity = Extract<SketchEntity, { readonly kind: 'arc' }>;

export function arcFields(entity: ArcEntity): ReadonlyArray<EntityField> {
  const r = entity.radiusMm;
  const sweepRad = Math.abs(entity.sweepDeg) / RAD_TO_DEG;
  return [
    mmField('centerX', 'Centre X', entity.center.x, 'position', { editable: true }),
    mmField('centerY', 'Centre Y', entity.center.y, 'position', { editable: true }),
    mmField('radius', 'Radius', r, 'size', { editable: true, min: 0 }),
    degField('startAngle', 'Start angle', entity.startAngleDeg, true),
    degField('sweep', 'Sweep', entity.sweepDeg, true),
    // Arc length is editable, unusually for a derived value: "make this arc exactly
    // 50 mm long" solves for radius at the sweep already set, which is the
    // direction an operator actually wants.
    mmField('arcLength', 'Arc length', r * sweepRad, 'derived', { editable: true, min: 0 }),
    derivedField('chord', 'Chord', 2 * r * Math.sin(sweepRad / 2), 'mm'),
  ];
}
