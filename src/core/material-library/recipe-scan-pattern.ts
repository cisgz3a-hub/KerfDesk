// ADR-093 Amendment 2 (Oracle audit O9-P2-1): a material preset carries the
// settings that decide how often and at what angle an operation scans, because
// they change the energy a burn deposits. An Image with Cross-hatch on scans
// every pass twice (ADR-492); an angle step turns each pass (ADR-492); a Fill
// ramp lowers the power at the shape's edges (ADR-699). LightBurn's library
// stores a layer's whole cut setting, so applying an entry sets these too.
//
// Each is held only while it is on, as the operation holds it: absent means an
// image scanned along X, no cross-hatch, no angle step and no ramp. Applying a
// preset that does not hold one turns it off on the operation.

import { normalizedScanAngleDeg } from '../raster/raster-scan-frame';
import type { LayerOperationSettings } from '../scene';
import { isFiniteNumber } from '../util/finite';

export type RecipeScanPattern = Pick<
  LayerOperationSettings,
  | 'imageScanAngleDeg'
  | 'imageCrossHatch'
  | 'passAngleStepDeg'
  | 'fillRampLengthMm'
  | 'fillRampOuterEdge'
>;

export const RECIPE_SCAN_PATTERN_FIELDS = [
  'imageScanAngleDeg',
  'imageCrossHatch',
  'passAngleStepDeg',
  'fillRampLengthMm',
  'fillRampOuterEdge',
] as const satisfies ReadonlyArray<keyof RecipeScanPattern>;

/** The scan pattern an operation (or a recipe) holds, with each setting only while it is on. */
export function recipeScanPattern(source: RecipeScanPattern): RecipeScanPattern {
  const scanAngle = normalizedScanAngleDeg(source.imageScanAngleDeg);
  const angleStep = normalizedScanAngleDeg(source.passAngleStepDeg);
  const rampLength = isFiniteNumber(source.fillRampLengthMm) ? source.fillRampLengthMm : 0;
  return {
    ...(scanAngle === 0 ? {} : { imageScanAngleDeg: scanAngle }),
    ...(source.imageCrossHatch === true ? { imageCrossHatch: true } : {}),
    ...(angleStep === 0 ? {} : { passAngleStepDeg: angleStep }),
    ...(rampLength > 0 ? { fillRampLengthMm: rampLength } : {}),
    ...(rampLength > 0 && source.fillRampOuterEdge === true ? { fillRampOuterEdge: true } : {}),
  };
}

/** The settings without a scan pattern: what a preset is laid over. */
export function withoutScanPattern<T extends RecipeScanPattern>(
  settings: T,
): Omit<T, keyof RecipeScanPattern> {
  const {
    imageScanAngleDeg: _scanAngle,
    imageCrossHatch: _crossHatch,
    passAngleStepDeg: _angleStep,
    fillRampLengthMm: _rampLength,
    fillRampOuterEdge: _rampOuterEdge,
    ...rest
  } = settings;
  return rest;
}

/** Whether a stored recipe's scan pattern fields are well formed (each optional). */
export function isRecipeScanPattern(value: Readonly<Record<string, unknown>>): boolean {
  return (
    optionalFinite(value.imageScanAngleDeg) &&
    optionalBoolean(value.imageCrossHatch) &&
    optionalFinite(value.passAngleStepDeg) &&
    (value.fillRampLengthMm === undefined ||
      (isFiniteNumber(value.fillRampLengthMm) && value.fillRampLengthMm >= 0)) &&
    optionalBoolean(value.fillRampOuterEdge)
  );
}

function optionalFinite(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}
