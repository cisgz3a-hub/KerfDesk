const MAX_COORDINATE_MAGNITUDE_MM = 1_000_000;
const MAX_TRANSFORM_SCALE = 100_000;

export function validateArray(
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

export function firstError(errors: ReadonlyArray<string | null>): string | null {
  for (const error of errors) {
    if (error !== null) return error;
  }
  return null;
}

export function requireString(obj: Record<string, unknown>, path: string): string | null {
  return typeof valueAtPath(obj, path) === 'string' ? null : `missing or invalid \`${path}\``;
}

export function optionalString(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || typeof value === 'string' ? null : `missing or invalid \`${path}\``;
}

export function requireBoolean(obj: Record<string, unknown>, path: string): string | null {
  return typeof valueAtPath(obj, path) === 'boolean' ? null : `missing or invalid \`${path}\``;
}

export function optionalBoolean(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || typeof value === 'boolean'
    ? null
    : `missing or invalid \`${path}\``;
}

export function requireNumber(obj: Record<string, unknown>, path: string): string | null {
  return isFiniteNumber(valueAtPath(obj, path)) ? null : `missing or invalid \`${path}\``;
}

export function requireCoordinate(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && Math.abs(value) <= MAX_COORDINATE_MAGNITUDE_MM
    ? null
    : `missing or invalid \`${path}\``;
}

export function requireScale(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && Math.abs(value) <= MAX_TRANSFORM_SCALE
    ? null
    : `missing or invalid \`${path}\``;
}

export function optionalNumber(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || isFiniteNumber(value) ? null : `missing or invalid \`${path}\``;
}

export function requirePositiveNumber(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && value > 0 ? null : `missing or invalid \`${path}\``;
}

export function optionalPositiveNumber(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && value > 0)
    ? null
    : `missing or invalid \`${path}\``;
}

export function optionalPositiveInteger(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && Number.isInteger(value) && value > 0)
    ? null
    : `missing or invalid \`${path}\``;
}

export function optionalNonNegativeNumber(
  obj: Record<string, unknown>,
  path: string,
): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && value >= 0)
    ? null
    : `missing or invalid \`${path}\``;
}

export function requireNonNegativeNumber(
  obj: Record<string, unknown>,
  path: string,
): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && value >= 0 ? null : `missing or invalid \`${path}\``;
}

export function requirePositiveInteger(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0
    ? null
    : `missing or invalid \`${path}\``;
}

export function requireIntegerInRange(
  obj: Record<string, unknown>,
  path: string,
  min: number,
  max: number,
): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max
    ? null
    : `missing or invalid \`${path}\``;
}

export function requireUnitRatio(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && value > 0 && value < 1
    ? null
    : `missing or invalid \`${path}\``;
}

export function requirePercent(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return isFiniteNumber(value) && value >= 0 && value <= 100
    ? null
    : `missing or invalid \`${path}\``;
}

export function optionalPercent(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (isFiniteNumber(value) && value >= 0 && value <= 100)
    ? null
    : `missing or invalid \`${path}\``;
}

export function requireLiteral(
  obj: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): string | null {
  const value = valueAtPath(obj, path);
  return typeof value === 'string' && allowed.includes(value)
    ? null
    : `missing or invalid \`${path}\``;
}

export function optionalLiteral(
  obj: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || (typeof value === 'string' && allowed.includes(value))
    ? null
    : `missing or invalid \`${path}\``;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function valueAtPath(obj: Record<string, unknown>, path: string): unknown {
  return obj[path.slice(path.lastIndexOf('.') + 1)];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
