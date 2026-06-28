import { DITHER_ALGORITHMS } from '../../core/scene';

export function validateLayerSubLayers(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validateLayerSubLayer);
}

function validateLayerSubLayer(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(value, `${path}.id`),
    requireString(value, `${path}.label`),
    requireBoolean(value, `${path}.enabled`),
    validateLayerOperationSettings(value['settings'], `${path}.settings`),
  ]);
}

function validateLayerOperationSettings(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireLiteral(value, `${path}.mode`, ['line', 'fill', 'image']),
    optionalPercent(value, `${path}.minPower`),
    requirePercent(value, `${path}.power`),
    requirePositiveNumber(value, `${path}.speed`),
    requirePositiveInteger(value, `${path}.passes`),
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
    optionalBoolean(value, `${path}.fillCrossHatch`),
    optionalDither(value, `${path}.ditherAlgorithm`),
    optionalPositiveNumber(value, `${path}.linesPerMm`),
    optionalBoolean(value, `${path}.imageBidirectional`),
    optionalBoolean(value, `${path}.negativeImage`),
    optionalBoolean(value, `${path}.passThrough`),
    optionalNonNegativeNumber(value, `${path}.dotWidthCorrectionMm`),
  ]);
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

function requireBoolean(obj: Record<string, unknown>, path: string): string | null {
  return typeof valueAtPath(obj, path) === 'boolean' ? null : `missing or invalid \`${path}\``;
}

function optionalBoolean(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || typeof value === 'boolean'
    ? null
    : `missing or invalid \`${path}\``;
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

function optionalPositiveInteger(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && Number.isInteger(value) && value > 0)
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

function optionalDither(obj: Record<string, unknown>, path: string): string | null {
  return optionalLiteral(obj, path, DITHER_ALGORITHMS);
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

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
