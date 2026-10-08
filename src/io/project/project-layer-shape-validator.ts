import { validateCncReliefAuthoringSettings } from './project-cnc-relief-authoring-settings';
import { normalizeCncPocketRestStock } from '../../core/cnc/cnc-pocket-rest-stock-settings';
import { normalizeCncTaperedInlay } from '../../core/cnc/tapered-inlay-settings';
import { DITHER_ALGORITHMS } from '../../core/scene';
import { validateCncStageRecipes } from './project-cnc-stage-validator';
import { cutExtrasFieldErrors } from './project-cut-extras-validator';
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
  optionalString,
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
    validateTaperedInlay(layer['cnc'], path),
    validatePocketRestStock(layer['cnc'], path),
    ...(isObject(layer['cnc'])
      ? [validateCncReliefAuthoringSettings(layer['cnc'], path + '.cnc')]
      : []),
    validateCncStageRecipes(layer['cnc'], `${path}.cnc`),
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
    optionalBoolean(layer, `${path}.parkedOutput`),
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
    ...cutExtrasFieldErrors(layer, path),
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
    optionalString(value, `${path}.presetRevision`),
    validateLayerOperationSettings(value['lastResolved'], `${path}.lastResolved`),
  ]);
}

function validateTaperedInlay(cnc: unknown, path: string): string | null {
  if (!isObject(cnc) || cnc['taperedInlay'] === undefined) return null;
  return normalizeCncTaperedInlay(cnc['taperedInlay']) === undefined
    ? path + '.cnc.taperedInlay must retain valid paired depths and clearances'
    : null;
}

function validatePocketRestStock(cnc: unknown, path: string): string | null {
  if (!isObject(cnc) || cnc['pocketRestStock'] === undefined) return null;
  return normalizeCncPocketRestStock(cnc['pocketRestStock']) === undefined
    ? path + '.cnc.pocketRestStock must retain a valid predecessor tool and stock tolerance'
    : null;
}
