// design-entity-fields — dispatch from an entity to the dimensions it exposes
// (ADR-268, DS-3b).
//
// The inspector never switches on entity kind: it renders whatever list comes back
// from here, so adding a shape means adding one arm plus one builder file and no UI
// change at all. Per-kind builders live beside this file; the shared vocabulary is
// in design-field-types.

import type { SketchEntity } from '../../core/design';
import { arcFields } from './design-fields-arc';
import { circleFields } from './design-fields-circle';
import { lineFields } from './design-fields-line';
import { pathFields } from './design-fields-path';
import { rectFields } from './design-fields-rect';
import type { EntityField, MeasurementKey } from './design-field-types';

export type { EntityField, FieldGroup, FieldUnit, MeasurementKey } from './design-field-types';

export function entityFields(entity: SketchEntity): ReadonlyArray<EntityField> {
  switch (entity.kind) {
    case 'rect':
      return rectFields(entity);
    case 'circle':
      return circleFields(entity);
    case 'line':
      return lineFields(entity);
    case 'arc':
      return arcFields(entity);
    case 'path':
      return pathFields(entity);
  }
}

export function fieldByKey(entity: SketchEntity, key: MeasurementKey): EntityField | null {
  return entityFields(entity).find((field) => field.key === key) ?? null;
}
