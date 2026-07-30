// design-field-format — how a dimension reads, in one place (ADR-268, DS-3b).
//
// The inspector input and the on-canvas call-out must show the SAME number: if a
// field says 49.99 and the arrow says 50, the operator cannot trust either. One
// formatter, both surfaces.
//
// Precision is deliberate. Millimetres carry 2 decimals (0.01 mm is finer than
// any kerf), angles 1 decimal, areas 1, node counts none. Trailing zeros are kept
// so a column of numbers stays aligned and does not jitter as digits change.

import type { EntityField, FieldUnit } from './design-field-types';

export type { EntityField, FieldUnit } from './design-field-types';

const MM_DECIMALS = 2;
const DEG_DECIMALS = 1;
const AREA_DECIMALS = 1;

export function fieldDecimals(unit: FieldUnit): number {
  switch (unit) {
    case 'mm':
      return MM_DECIMALS;
    case 'deg':
      return DEG_DECIMALS;
    case 'mm2':
      return AREA_DECIMALS;
    case 'count':
      return 0;
  }
}

export function unitSuffix(unit: FieldUnit): string {
  switch (unit) {
    case 'mm':
      return 'mm';
    case 'deg':
      return '°';
    case 'mm2':
      return 'mm²';
    case 'count':
      return '';
  }
}

// The number alone, for an input's value.
export function formatFieldNumber(field: EntityField): string {
  if (!Number.isFinite(field.value)) return '';
  return field.value.toFixed(fieldDecimals(field.unit));
}

// Number plus unit, for the on-canvas call-out chip.
export function formatFieldValue(field: EntityField): string {
  const suffix = unitSuffix(field.unit);
  const number = formatFieldNumber(field);
  return suffix === '' ? number : `${number} ${suffix}`;
}

// Accepts what a person actually types: a bare number, a unit suffix, a comma
// decimal separator, or a leading + sign. Returns null when there is no number in
// there at all, which the caller treats as "keep the old value".
export function parseFieldNumber(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(',', '.')
    .replace(/\s*(mm²|mm2|mm|°|deg)\s*$/i, '')
    .trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '+' || cleaned === '.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
