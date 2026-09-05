import { DITHER_ALGORITHMS } from '../../core/scene';
import { objectOperationSettingKeys } from '../../core/scene/object-operation-settings';
import { layerSubLayerOperationId } from '../../core/scene/layer';
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
    optionalLiteral(value, `${path}.fillStyle`, ['scanline', 'offset', 'island']),
    optionalBoolean(value, `${path}.fillBidirectional`),
    optionalBoolean(value, `${path}.allowUncalibratedBidirectionalScan`),
    optionalNumber(value, `${path}.bidirectionalScanOffsetMm`),
    optionalBoolean(value, `${path}.fillCrossHatch`),
    optionalLiteral(value, `${path}.ditherAlgorithm`, DITHER_ALGORITHMS),
    optionalPositiveNumber(value, `${path}.linesPerMm`),
    optionalBoolean(value, `${path}.imageBidirectional`),
    optionalBoolean(value, `${path}.negativeImage`),
    optionalBoolean(value, `${path}.passThrough`),
    optionalNonNegativeNumber(value, `${path}.dotWidthCorrectionMm`),
    validateScopedOverrides(value['byOperation'], `${path}.byOperation`),
  ]);
}

function validateScopedOverrides(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  for (const [id, settings] of Object.entries(value)) {
    if (id.length === 0) return `invalid operation id in \`${path}\``;
    if (settings === null) continue;
    if (
      !isObject(settings) ||
      Object.keys(settings).some((key) => !objectOperationSettingKeys.has(key))
    )
      return `invalid \`${path}.${id}\``;
    const error = validateObjectOperationOverride(settings, `${path}.${id}`);
    if (error !== null) return error;
  }
  return null;
}

/** Scope references are new in v5. Legacy path IDs retain their existing
 * orphan-binding compatibility; only the new settings owners are checked. */
export function validateOperationOverrideReferences(
  layers: ReadonlyArray<unknown>,
  objects: ReadonlyArray<unknown>,
): string | null {
  const ids = operationReferenceCounts(layers);
  for (const [index, object] of objects.entries()) {
    if (!isObject(object) || !isObject(object['operationOverride'])) continue;
    const scopes = object['operationOverride']['byOperation'];
    if (!isObject(scopes)) continue;
    for (const id of Object.keys(scopes)) {
      if (ids.get(id) !== 1)
        return `invalid \`scene.objects[${index}].operationOverride.byOperation.${id}\`: dangling or ambiguous operation id`;
    }
  }
  return null;
}

function operationReferenceCounts(layers: ReadonlyArray<unknown>): ReadonlyMap<string, number> {
  const ids = new Map<string, number>();
  const append = (id: string): void => {
    ids.set(id, (ids.get(id) ?? 0) + 1);
  };
  for (const layer of layers) {
    if (!isObject(layer) || typeof layer['id'] !== 'string') continue;
    append(layer['id']);
    if (!Array.isArray(layer['subLayers'])) continue;
    for (const sub of layer['subLayers']) {
      if (isObject(sub) && typeof sub['id'] === 'string')
        append(layerSubLayerOperationId(layer['id'], sub['id']));
    }
  }
  return ids;
}
