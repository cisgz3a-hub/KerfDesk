import { DITHER_ALGORITHMS } from '../../core/scene';

export function validateProjectShape(raw: Record<string, unknown>): string | null {
  const device = raw['device'];
  if (!isObject(device)) return 'missing or invalid `device`';
  const workspace = raw['workspace'];
  if (!isObject(workspace)) return 'missing or invalid `workspace`';
  const scene = raw['scene'];
  if (!isObject(scene)) return 'missing or invalid `scene`';
  if (!Array.isArray(scene['objects'])) return 'missing or invalid `scene.objects`';
  if (!Array.isArray(scene['layers'])) return 'missing or invalid `scene.layers`';
  return firstError([
    validateDevice(device),
    validateWorkspace(workspace),
    validateOptimization(raw['optimization']),
    validateScene(scene),
  ]);
}

function validateOptimization(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return 'missing or invalid `optimization`';
  return optionalBoolean(value, 'optimization.reduceTravelMoves');
}

function validateDevice(device: Record<string, unknown>): string | null {
  return firstError([
    requireString(device, 'device.name'),
    requirePositiveNumber(device, 'device.bedWidth'),
    requirePositiveNumber(device, 'device.bedHeight'),
    requirePositiveNumber(device, 'device.maxFeed'),
    requirePositiveNumber(device, 'device.maxPowerS'),
    requireOrigin(device, 'device.origin'),
    validateHoming(device['homing']),
    requireString(device, 'device.autofocusCommand'),
    optionalNonNegativeNumber(device, 'device.minPowerS'),
    optionalBoolean(device, 'device.laserModeEnabled'),
    optionalPositiveNumber(device, 'device.framingFeedMmPerMin'),
    optionalPositiveNumber(device, 'device.accelMmPerSec2'),
    optionalPositiveNumber(device, 'device.junctionDeviationMm'),
  ]);
}

function validateHoming(value: unknown): string | null {
  if (!isObject(value)) return 'missing or invalid `device.homing`';
  return firstError([
    requireBoolean(value, 'device.homing.enabled'),
    requireOrigin(value, 'device.homing.direction'),
  ]);
}

function validateWorkspace(workspace: Record<string, unknown>): string | null {
  return firstError([
    requirePositiveNumber(workspace, 'workspace.width'),
    requirePositiveNumber(workspace, 'workspace.height'),
    requireLiteral(workspace, 'workspace.units', ['mm']),
  ]);
}

function validateScene(scene: Record<string, unknown>): string | null {
  const layers = scene['layers'];
  const objects = scene['objects'];
  if (!Array.isArray(objects) || !Array.isArray(layers)) return null;
  return (
    validateArray(layers, 'scene.layers', validateLayer) ??
    validateArray(objects, 'scene.objects', validateSceneObject)
  );
}

function validateLayer(layer: unknown, path: string): string | null {
  if (!isObject(layer)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(layer, `${path}.id`),
    requireString(layer, `${path}.color`),
    requireLiteral(layer, `${path}.mode`, ['line', 'fill', 'image']),
    optionalPercent(layer, `${path}.minPower`),
    requirePercent(layer, `${path}.power`),
    requirePositiveNumber(layer, `${path}.speed`),
    requirePositiveInteger(layer, `${path}.passes`),
    requireBoolean(layer, `${path}.visible`),
    requireBoolean(layer, `${path}.output`),
    optionalNumber(layer, `${path}.hatchAngleDeg`),
    optionalPositiveNumber(layer, `${path}.hatchSpacingMm`),
    optionalNonNegativeNumber(layer, `${path}.fillOverscanMm`),
    optionalBoolean(layer, `${path}.fillBidirectional`),
    optionalBoolean(layer, `${path}.fillCrossHatch`),
    optionalDither(layer, `${path}.ditherAlgorithm`),
    optionalPositiveNumber(layer, `${path}.linesPerMm`),
    optionalBoolean(layer, `${path}.negativeImage`),
    optionalBoolean(layer, `${path}.passThrough`),
    optionalNonNegativeNumber(layer, `${path}.dotWidthCorrectionMm`),
  ]);
}

function validateSceneObject(obj: unknown, path: string): string | null {
  if (!isObject(obj)) return `missing or invalid \`${path}\``;
  const kind = obj['kind'];
  if (kind === 'imported-svg') return validateVectorObject(obj, path);
  if (kind === 'text') return validateTextObject(obj, path);
  if (kind === 'traced-image') return validateVectorObject(obj, path);
  if (kind === 'raster-image') return validateRasterObject(obj, path);
  return `missing or invalid \`${path}.kind\``;
}

function validateVectorObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.source`),
    optionalPercent(obj, `${path}.powerScale`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    validateColoredPaths(obj['paths'], `${path}.paths`),
  ]);
}

function validateTextObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.content`),
    requireString(obj, `${path}.fontKey`),
    requirePositiveNumber(obj, `${path}.sizeMm`),
    requireLiteral(obj, `${path}.alignment`, ['left', 'center', 'right']),
    requirePositiveNumber(obj, `${path}.lineHeight`),
    optionalPercent(obj, `${path}.powerScale`),
    optionalNumber(obj, `${path}.letterSpacing`),
    requireString(obj, `${path}.color`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    validateColoredPaths(obj['paths'], `${path}.paths`),
  ]);
}

function validateRasterObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.source`),
    requireString(obj, `${path}.dataUrl`),
    requirePositiveInteger(obj, `${path}.pixelWidth`),
    requirePositiveInteger(obj, `${path}.pixelHeight`),
    optionalPercent(obj, `${path}.powerScale`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    requireString(obj, `${path}.color`),
    requireDither(obj, `${path}.dither`),
    requirePositiveNumber(obj, `${path}.linesPerMm`),
    optionalNumber(obj, `${path}.brightness`),
    optionalNumber(obj, `${path}.contrast`),
    optionalNumber(obj, `${path}.gamma`),
    optionalString(obj, `${path}.lumaBase64`),
    optionalLiteral(obj, `${path}.role`, ['trace-source']),
  ]);
}

function validateBounds(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireNumber(value, `${path}.minX`),
    requireNumber(value, `${path}.minY`),
    requireNumber(value, `${path}.maxX`),
    requireNumber(value, `${path}.maxY`),
  ]);
}

function validateTransform(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireNumber(value, `${path}.x`),
    requireNumber(value, `${path}.y`),
    requireNumber(value, `${path}.scaleX`),
    requireNumber(value, `${path}.scaleY`),
    requireNumber(value, `${path}.rotationDeg`),
    requireBoolean(value, `${path}.mirrorX`),
    requireBoolean(value, `${path}.mirrorY`),
  ]);
}

function validateColoredPaths(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validateColoredPath);
}

function validateColoredPath(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(value, `${path}.color`),
    validatePolylines(value['polylines'], `${path}.polylines`),
  ]);
}

function validatePolylines(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validatePolyline);
}

function validatePolyline(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireBoolean(value, `${path}.closed`),
    validatePoints(value['points'], `${path}.points`),
  ]);
}

function validatePoints(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validatePoint);
}

function validatePoint(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([requireNumber(value, `${path}.x`), requireNumber(value, `${path}.y`)]);
}

function validateArray(
  value: ReadonlyArray<unknown>,
  path: string,
  validate: (item: unknown, path: string) => string | null,
): string | null {
  for (let i = 0; i < value.length; i += 1) {
    const error = validate(value[i], `${path}[${i}]`);
    if (error !== null) return error;
  }
  return null;
}

function firstError(errors: ReadonlyArray<string | null>): string | null {
  for (const error of errors) {
    if (error !== null) return error;
  }
  return null;
}

function requireString(obj: Record<string, unknown>, path: string): string | null {
  return typeof valueAtPath(obj, path) === 'string' ? null : `missing or invalid \`${path}\``;
}

function optionalString(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || typeof value === 'string' ? null : `missing or invalid \`${path}\``;
}

function requireBoolean(obj: Record<string, unknown>, path: string): string | null {
  return typeof valueAtPath(obj, path) === 'boolean' ? null : `missing or invalid \`${path}\``;
}

function optionalBoolean(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || typeof value === 'boolean'
    ? null
    : `missing or invalid \`${path}\``;
}

function requireNumber(obj: Record<string, unknown>, path: string): string | null {
  return isFiniteNumber(valueAtPath(obj, path)) ? null : `missing or invalid \`${path}\``;
}

function optionalNumber(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || isFiniteNumber(value) ? null : `missing or invalid \`${path}\``;
}

function requirePositiveNumber(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && value > 0 ? null : `missing or invalid \`${path}\``;
}

function optionalPositiveNumber(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && value > 0)
    ? null
    : `missing or invalid \`${path}\``;
}

function optionalNonNegativeNumber(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && value >= 0)
    ? null
    : `missing or invalid \`${path}\``;
}

function requirePositiveInteger(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0
    ? null
    : `missing or invalid \`${path}\``;
}

function requirePercent(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && value >= 0 && value <= 100
    ? null
    : `missing or invalid \`${path}\``;
}

function optionalPercent(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && value >= 0 && value <= 100)
    ? null
    : `missing or invalid \`${path}\``;
}

function requireDither(obj: Record<string, unknown>, path: string): string | null {
  return requireLiteral(obj, path, DITHER_ALGORITHMS);
}

function optionalDither(obj: Record<string, unknown>, path: string): string | null {
  return optionalLiteral(obj, path, DITHER_ALGORITHMS);
}

function requireOrigin(obj: Record<string, unknown>, path: string): string | null {
  return requireLiteral(obj, path, [
    'front-left',
    'front-right',
    'rear-left',
    'rear-right',
    'center',
  ]);
}

function requireLiteral(
  obj: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): string | null {
  const value = valueAtPath(obj, path);
  return typeof value === 'string' && allowed.includes(value)
    ? null
    : `missing or invalid \`${path}\``;
}

function optionalLiteral(
  obj: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (typeof value === 'string' && allowed.includes(value))
    ? null
    : `missing or invalid \`${path}\``;
}

function valueAtPath(obj: Record<string, unknown>, path: string): unknown {
  return obj[path.slice(path.lastIndexOf('.') + 1)];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
