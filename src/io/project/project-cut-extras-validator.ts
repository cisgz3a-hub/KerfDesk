// ADR-415 and ADR-494 operation settings, shared by the operation,
// sub-operation and artwork-override validators. All optional: files written
// before them load as they did.

import {
  optionalBoolean,
  optionalLiteral,
  optionalNonNegativeNumber,
  optionalPercent,
  optionalPositiveNumber,
  valueAtPath,
} from './project-shape-primitives';

export function cutExtrasFieldErrors(
  value: Record<string, unknown>,
  path: string,
): ReadonlyArray<string | null> {
  return [
    optionalBoolean(value, `${path}.perforationEnabled`),
    optionalPositiveNumber(value, `${path}.perforationCutMm`),
    optionalPositiveNumber(value, `${path}.perforationSkipMm`),
    optionalNonNegativeNumber(value, `${path}.overcutMm`),
    optionalNonNegativeNumber(value, `${path}.imageOverscanMm`),
    optionalLiteral(value, `${path}.tabLayout`, ['count', 'spacing']),
    optionalPositiveNumber(value, `${path}.tabSpacingMm`),
    optionalNonNegativeInteger(value, `${path}.tabMaxPerShape`),
    optionalPercent(value, `${path}.tabCutPowerPercent`),
  ];
}

// 0 means no cap on tabs per shape.
function optionalNonNegativeInteger(value: Record<string, unknown>, path: string): string | null {
  const field = valueAtPath(value, path);
  return field === undefined || (typeof field === 'number' && Number.isInteger(field) && field >= 0)
    ? null
    : `missing or invalid \`${path}\``;
}
