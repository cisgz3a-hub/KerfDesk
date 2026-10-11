import { DESIGN_CUT_TYPES, DEFAULT_DESIGN_LAYER_ID } from '../../core/design/layers/design-layer';
import type { DesignStudioDocument } from '../../core/design/design-studio-document';
import {
  firstError,
  isObject,
  optionalBoolean,
  optionalString,
  requireBoolean,
  requireCoordinate,
  requireNumber,
  requireString,
} from './project-shape-primitives';

const MAX_ENTITIES = 100_000;
const MAX_POINTS = 1_000_000;
const MAX_LAYERS = 4096;

export function validateDesignStudioDocument(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value) || value['version'] !== 1) return 'invalid designStudioDocument.version';
  const error = firstError([
    requireString(value, 'activeLayerId'),
    requireBoolean(value, 'surface3d'),
    validateSketch(value['sketch']),
    validateIds(value['appliedObjectIds'], 'appliedObjectIds', MAX_ENTITIES),
    validateOperationPairs(value['appliedOperationsByLayer']),
    validateOperationPairs(value['appliedEntityObjectIds'], MAX_ENTITIES),
  ]);
  const ownership = error ?? validateOwnership(value as unknown as DesignStudioDocument);
  return ownership === null ? null : `invalid designStudioDocument: ${ownership}`;
}

function validateOwnership(document: DesignStudioDocument): string | null {
  const entityIds = new Set(
    document.sketch.entities.filter((entity) => !entity.construction).map((entity) => entity.id),
  );
  const layerIds = new Set(
    document.sketch.layers?.length
      ? document.sketch.layers.map((layer) => layer.id)
      : [DEFAULT_DESIGN_LAYER_ID],
  );
  if (!layerIds.has(document.activeLayerId)) return 'activeLayerId';
  if (
    document.sketch.entities.some(
      (entity) => entity.layerId !== undefined && !layerIds.has(entity.layerId),
    )
  )
    return 'sketch.entity layerId';
  const targets = document.appliedEntityObjectIds.map(([, id]) => id);
  if (
    new Set(targets).size !== targets.length ||
    targets.length !== document.appliedObjectIds.length
  )
    return 'output ownership';
  const owned = new Set(document.appliedObjectIds);
  if (
    document.appliedEntityObjectIds.some(
      ([entity, object]) => !entityIds.has(entity) || !owned.has(object),
    )
  )
    return 'output ownership';
  const operationTargets = new Set(document.appliedOperationsByLayer.map(([, id]) => id));
  if (
    operationTargets.size !== document.appliedOperationsByLayer.length ||
    document.appliedOperationsByLayer.some(([layer]) => !layerIds.has(layer))
  )
    return 'operation ownership';
  return null;
}

function validateIds(value: unknown, path: string, max: number): string | null {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 1024)
  )
    return path;
  return new Set(value).size === value.length ? null : `${path} duplicate IDs`;
}

function validateOperationPairs(value: unknown, max = MAX_LAYERS): string | null {
  if (!Array.isArray(value) || value.length > max) return 'applied ID pairs';
  if (
    value.some(
      (pair) =>
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some((id: unknown) => typeof id !== 'string' || id.length === 0 || id.length > 1024),
    )
  )
    return 'appliedOperationsByLayer';
  return validateIds(
    value.map((pair: [string, string]) => pair[0]),
    'applied ID pairs',
    max,
  );
}

function validateSketch(value: unknown): string | null {
  if (!isObject(value) || !Array.isArray(value['entities'])) return 'sketch.entities';
  const entities: unknown[] = value['entities'];
  if (entities.length > MAX_ENTITIES) return 'sketch.entities budget';
  const ids: string[] = [];
  let points = 0;
  for (const entity of entities) {
    const error = validateEntity(entity);
    if (error !== null) return error;
    if (!isObject(entity)) return 'sketch.entity';
    ids.push(entity['id'] as string);
    if (Array.isArray(entity['points'])) points += entity['points'].length;
    if (points > MAX_POINTS) return 'sketch.points budget';
  }
  return validateIds(ids, 'sketch.entities', MAX_ENTITIES) ?? validateLayers(value['layers']);
}

function point(value: unknown): boolean {
  return (
    isObject(value) &&
    requireCoordinate(value, 'x') === null &&
    requireCoordinate(value, 'y') === null
  );
}

function nonnegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

function validateEntity(value: unknown): string | null {
  if (!isObject(value)) return 'sketch.entity';
  const common = firstError([
    requireString(value, 'id'),
    optionalString(value, 'layerId'),
    optionalBoolean(value, 'construction'),
  ]);
  if (common !== null) return common;
  return validGeometry(value) ? null : `sketch.entity ${String(value['id'])} geometry`;
}

function validGeometry(value: Record<string, unknown>): boolean {
  switch (value['kind']) {
    case 'line':
      return point(value['start']) && point(value['end']);
    case 'circle':
      return point(value['center']) && nonnegative(value['radiusMm']);
    case 'arc':
      return validArc(value);
    case 'ellipse':
      return (
        point(value['center']) && nonnegative(value['radiusXMm']) && nonnegative(value['radiusYMm'])
      );
    case 'rect':
      return (
        point(value['origin']) &&
        ['widthMm', 'heightMm', 'cornerRadiusMm'].every((field) => nonnegative(value[field]))
      );
    case 'path':
      return validPath(value);
    default:
      return false;
  }
}

function validArc(value: Record<string, unknown>): boolean {
  return (
    point(value['center']) &&
    nonnegative(value['radiusMm']) &&
    requireCoordinate(value, 'startAngleDeg') === null &&
    requireNumber(value, 'sweepDeg') === null &&
    Math.abs(value['sweepDeg'] as number) <= 360
  );
}

function validPath(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value['points']) &&
    value['points'].length <= MAX_POINTS &&
    value['points'].every(point) &&
    typeof value['closed'] === 'boolean'
  );
}

function validateLayers(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > MAX_LAYERS) return 'sketch.layers';
  const ids: string[] = [];
  for (const layer of value) {
    if (!isObject(layer)) return 'sketch.layer';
    const error = firstError([
      requireString(layer, 'id'),
      requireString(layer, 'name'),
      optionalString(layer, 'toolId'),
      optionalString(layer, 'vClearToolId'),
      optionalBoolean(layer, 'vCarveFlatDepthEnabled'),
    ]);
    if (error !== null) return error;
    if (
      typeof layer['color'] !== 'string' ||
      !/^#[\da-f]{6}$/i.test(layer['color']) ||
      !DESIGN_CUT_TYPES.some((kind) => kind === layer['cutType']) ||
      !nonnegative(layer['depthMm']) ||
      layer['depthMm'] === 0
    )
      return 'sketch.layer settings';
    ids.push(layer['id'] as string);
  }
  return validateIds(ids, 'sketch.layers', MAX_LAYERS);
}
