// Validates a barcode shape spec (ADR-386) read from a .lf2 file. The saved
// paths are the engraving authority, but the spec is what an edit or a
// variable-data copy re-encodes, so every field must be in range.

import { BARCODE_LIMITS } from '../../core/barcode';
import { validateVariableTemplate } from './project-variable-validator';
import {
  firstError,
  requireBoolean,
  requireIntegerInRange,
  requireLiteral,
  requireString,
  valueAtPath,
} from './project-shape-primitives';

const SYMBOLOGIES = ['qr', 'data-matrix', 'code128', 'code39', 'ean13', 'upca', 'ean8'] as const;
// Far above any symbology's capacity (QR Code tops out at 7089 digits) while
// still bounding a hand-edited file.
const MAX_BARCODE_DATA_LENGTH = 8_000;

export function validateBarcodeSpec(value: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireLiteral(value, `${path}.symbology`, SYMBOLOGIES),
    requireString(value, `${path}.data`),
    dataLength(value, `${path}.data`),
    validateVariableTemplate(value['variableTemplate'], `${path}.variableTemplate`),
    requireLiteral(value, `${path}.errorCorrection`, ['L', 'M', 'Q', 'H']),
    requireLiteral(value, `${path}.sizeMode`, ['module', 'width']),
    numberInRange(value, `${path}.moduleMm`, BARCODE_LIMITS.moduleMm),
    numberInRange(value, `${path}.widthMm`, BARCODE_LIMITS.widthMm),
    numberInRange(value, `${path}.barHeightMm`, BARCODE_LIMITS.barHeightMm),
    requireIntegerInRange(
      value,
      `${path}.quietZoneModules`,
      BARCODE_LIMITS.quietZoneModules.min,
      BARCODE_LIMITS.quietZoneModules.max,
    ),
    requireBoolean(value, `${path}.invert`),
    requireBoolean(value, `${path}.showText`),
  ]);
}

function dataLength(value: Record<string, unknown>, path: string): string | null {
  const data = valueAtPath(value, path);
  return typeof data === 'string' && data.length > MAX_BARCODE_DATA_LENGTH
    ? `invalid \`${path}\`: longer than ${MAX_BARCODE_DATA_LENGTH} characters`
    : null;
}

function numberInRange(
  value: Record<string, unknown>,
  path: string,
  range: { readonly min: number; readonly max: number },
): string | null {
  const field = valueAtPath(value, path);
  return typeof field === 'number' &&
    Number.isFinite(field) &&
    field >= range.min &&
    field <= range.max
    ? null
    : `missing or invalid \`${path}\``;
}
