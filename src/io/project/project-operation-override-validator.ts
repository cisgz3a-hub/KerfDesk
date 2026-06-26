import { DITHER_ALGORITHMS } from '../../core/scene';
import {
  firstError,
  isObject,
  optionalBoolean,
  optionalLiteral,
  optionalNonNegativeNumber,
  optionalNumber,
  optionalPercent,
  optionalPositiveInteger,
  optionalPositiveNumber,
} from './project-shape-primitives';

export function validateObjectOperationOverride(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    optionalLiteral(value, `${path}.mode`, ['line', 'fill', 'image']),
    optionalPercent(value, `${path}.minPower`),
    optionalPercent(value, `${path}.power`),
    optionalPositiveNumber(value, `${path}.speed`),
    optionalPositiveInteger(value, `${path}.passes`),
    optionalBoolean(value, `${path}.airAssist`),
    optionalNumber(value, `${path}.kerfOffsetMm`),
    optionalBoolean(value, `${path}.tabsEnabled`),
    optionalPositiveNumber(value, `${path}.tabSizeMm`),
    optionalPositiveInteger(value, `${path}.tabsPerShape`),
    optionalBoolean(value, `${path}.tabSkipInnerShapes`),
    optionalNumber(value, `${path}.hatchAngleDeg`),
    optionalPositiveNumber(value, `${path}.hatchSpacingMm`),
    optionalNonNegativeNumber(value, `${path}.fillOverscanMm`),
    optionalLiteral(value, `${path}.fillStyle`, ['scanline', 'offset']),
    optionalBoolean(value, `${path}.fillBidirectional`),
    optionalBoolean(value, `${path}.fillCrossHatch`),
    optionalLiteral(value, `${path}.ditherAlgorithm`, DITHER_ALGORITHMS),
    optionalPositiveNumber(value, `${path}.linesPerMm`),
    optionalBoolean(value, `${path}.imageBidirectional`),
    optionalBoolean(value, `${path}.negativeImage`),
    optionalBoolean(value, `${path}.passThrough`),
    optionalNonNegativeNumber(value, `${path}.dotWidthCorrectionMm`),
  ]);
}
