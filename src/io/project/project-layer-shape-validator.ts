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
  requireBoolean,
  requireLiteral,
  requirePercent,
  requirePositiveInteger,
  requirePositiveNumber,
  requireString,
} from './project-shape-primitives';
import { validateLayerOperationSettings, validateLayerSubLayers } from './project-layer-validator';

export function validateProjectLayer(layer: unknown, path: string): string | null {
  if (!isObject(layer)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(layer, `${path}.id`),
    requireString(layer, `${path}.name`),
    requireString(layer, `${path}.color`),
    requireLiteral(layer, `${path}.mode`, ['line', 'fill', 'image']),
    optionalLiteral(layer, `${path}.powerMode`, ['constant', 'dynamic']),
    optionalPercent(layer, `${path}.minPower`),
    requirePercent(layer, `${path}.power`),
    requirePositiveNumber(layer, `${path}.speed`),
    requirePositiveInteger(layer, `${path}.passes`),
    requireBoolean(layer, `${path}.visible`),
    requireBoolean(layer, `${path}.output`),
    optionalBoolean(layer, `${path}.airAssist`),
    optionalNumber(layer, `${path}.kerfOffsetMm`),
    optionalBoolean(layer, `${path}.tabsEnabled`),
    optionalPositiveNumber(layer, `${path}.tabSizeMm`),
    optionalPositiveInteger(layer, `${path}.tabsPerShape`),
    optionalBoolean(layer, `${path}.tabSkipInnerShapes`),
    optionalNumber(layer, `${path}.hatchAngleDeg`),
    optionalPositiveNumber(layer, `${path}.hatchSpacingMm`),
    optionalNonNegativeNumber(layer, `${path}.fillOverscanMm`),
    optionalLiteral(layer, `${path}.fillStyle`, ['scanline', 'offset', 'island']),
    optionalBoolean(layer, `${path}.fillBidirectional`),
    optionalBoolean(layer, `${path}.allowUncalibratedBidirectionalScan`),
    optionalNumber(layer, `${path}.bidirectionalScanOffsetMm`),
    optionalLiteral(layer, `${path}.scanOffsetCalibrationMode`, ['baseline', 'verification']),
    optionalBoolean(layer, `${path}.fillCrossHatch`),
    optionalLiteral(layer, `${path}.ditherAlgorithm`, DITHER_ALGORITHMS),
    optionalPositiveNumber(layer, `${path}.linesPerMm`),
    optionalBoolean(layer, `${path}.imageBidirectional`),
    optionalBoolean(layer, `${path}.negativeImage`),
    optionalBoolean(layer, `${path}.passThrough`),
    optionalNonNegativeNumber(layer, `${path}.dotWidthCorrectionMm`),
    validateLayerSubLayers(layer['subLayers'], `${path}.subLayers`),
    validateMaterialBinding(layer['materialBinding'], `${path}.materialBinding`),
  ]);
}

function validateMaterialBinding(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(value, `${path}.libraryId`),
    requireString(value, `${path}.presetId`),
    validateLayerOperationSettings(value['lastResolved'], `${path}.lastResolved`),
  ]);
}
