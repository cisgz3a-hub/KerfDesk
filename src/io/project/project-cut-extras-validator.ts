// ADR-415, ADR-494, ADR-492, ADR-495, ADR-626 and ADR-670 operation settings, shared by the operation,
// sub-operation and artwork-override validators. All optional: files written
// before them load as they did.

import { isPhotoToneCurve } from '../../core/raster/photo-tone-curve';
import {
  optionalBoolean,
  optionalLiteral,
  optionalNonNegativeNumber,
  optionalPercent,
  optionalNumber,
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
    optionalNumber(value, `${path}.imageScanAngleDeg`),
    optionalBoolean(value, `${path}.imageCrossHatch`),
    optionalNumber(value, `${path}.passAngleStepDeg`),
    optionalBoolean(value, `${path}.autoOverscan`),
    optionalBoolean(value, `${path}.leadInEnabled`),
    optionalBoolean(value, `${path}.leadOutEnabled`),
    optionalLiteral(value, `${path}.leadStyle`, ['arc', 'line']),
    optionalPositiveNumber(value, `${path}.leadLengthMm`),
    optionalNumber(value, `${path}.leadAngleDeg`),
    optionalLiteral(value, `${path}.leadSide`, ['auto', 'outside', 'inside']),
    optionalPhotoToneCurve(value, `${path}.photoToneCurve`),
  ];
}

// ADR-670: a curve that is not monotonic and pinned at both ends would burn
// blank material or soften solid marks, so the file is refused, not repaired.
function optionalPhotoToneCurve(value: Record<string, unknown>, path: string): string | null {
  const field = valueAtPath(value, path);
  return field === undefined || isPhotoToneCurve(field) ? null : `missing or invalid \`${path}\``;
}

// 0 means no cap on tabs per shape.
function optionalNonNegativeInteger(value: Record<string, unknown>, path: string): string | null {
  const field = valueAtPath(value, path);
  return field === undefined || (typeof field === 'number' && Number.isInteger(field) && field >= 0)
    ? null
    : `missing or invalid \`${path}\``;
}
