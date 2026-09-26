// ADR-415 operation settings, shared by the operation, sub-operation and
// artwork-override validators. All optional: files written before them load
// as they did.

import {
  optionalBoolean,
  optionalNonNegativeNumber,
  optionalPositiveNumber,
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
  ];
}
