// design-field-types — the vocabulary of a dimension (ADR-268, DS-3b).
//
// Types only, so the field builders, the editor, the annotation geometry, and the
// formatter can all share one definition without importing each other.
//
// `MeasurementKey` is deliberately a flat union rather than per-kind unions: it is
// the identity that links an inspector row to the call-out drawn on the shape, and
// a single namespace keeps that link trivial to look up. Because it is wide,
// consumers use keyed lookup tables rather than switches.

export type MeasurementKey =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'cornerRadius'
  | 'centerX'
  | 'centerY'
  | 'radius'
  | 'diameter'
  | 'circumference'
  | 'startX'
  | 'startY'
  | 'endX'
  | 'endY'
  | 'length'
  | 'angle'
  | 'startAngle'
  | 'sweep'
  | 'arcLength'
  | 'chord'
  | 'area'
  | 'perimeter'
  | 'points';

export type FieldUnit = 'mm' | 'mm2' | 'deg' | 'count';

export type FieldGroup = 'position' | 'size' | 'shape' | 'derived';

export type EntityField = {
  readonly key: MeasurementKey;
  readonly label: string;
  readonly value: number;
  readonly unit: FieldUnit;
  readonly editable: boolean;
  readonly group: FieldGroup;
  // Smallest legal value when editable, so the input can refuse nonsense without
  // the store having to sanitize a half-typed number.
  readonly min?: number;
};

export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const TAU = Math.PI * 2;

// Field builders are verbose by nature; these keep each one to its data.
export function mmField(
  key: MeasurementKey,
  label: string,
  value: number,
  group: FieldGroup,
  options: { readonly editable: boolean; readonly min?: number },
): EntityField {
  return options.min === undefined
    ? { key, label, value, unit: 'mm', group, editable: options.editable }
    : { key, label, value, unit: 'mm', group, editable: options.editable, min: options.min };
}

export function degField(
  key: MeasurementKey,
  label: string,
  value: number,
  editable: boolean,
): EntityField {
  return { key, label, value, unit: 'deg', group: 'shape', editable };
}

export function derivedField(
  key: MeasurementKey,
  label: string,
  value: number,
  unit: FieldUnit,
): EntityField {
  return { key, label, value, unit, group: 'derived', editable: false };
}
