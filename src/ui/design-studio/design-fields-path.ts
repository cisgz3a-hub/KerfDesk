// design-fields-path — the dimensions a freehand path exposes (ADR-268, DS-3b).
//
// A path has no parametric handles, so it reports its extents and its measured run
// length rather than pretending its size is typeable. X and Y ARE editable, because
// moving a path by typing a coordinate is both meaningful and expected.

import { entityBounds, entityToPolylines, type SketchEntity } from '../../core/design';
import { derivedField, mmField, type EntityField } from './design-field-types';

export type PathEntity = Extract<SketchEntity, { readonly kind: 'path' }>;

export function pathFields(entity: PathEntity): ReadonlyArray<EntityField> {
  const bounds = entityBounds(entity);
  const runMm = pathRunLengthMm(entity);
  return [
    mmField('x', 'X', bounds.minX, 'position', { editable: true }),
    mmField('y', 'Y', bounds.minY, 'position', { editable: true }),
    mmField('width', 'Width', bounds.maxX - bounds.minX, 'size', { editable: false }),
    mmField('height', 'Height', bounds.maxY - bounds.minY, 'size', { editable: false }),
    {
      key: 'points',
      label: 'Nodes',
      value: entity.points.length,
      unit: 'count',
      group: 'shape',
      editable: false,
    },
    entity.closed
      ? derivedField('perimeter', 'Perimeter', runMm, 'mm')
      : derivedField('length', 'Length', runMm, 'mm'),
  ];
}

export function pathRunLengthMm(entity: SketchEntity): number {
  let total = 0;
  for (const polyline of entityToPolylines(entity)) {
    const points = polyline.points;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      if (from === undefined || to === undefined) continue;
      total += Math.hypot(to.x - from.x, to.y - from.y);
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (polyline.closed && first !== undefined && last !== undefined) {
      total += Math.hypot(first.x - last.x, first.y - last.y);
    }
  }
  return total;
}
