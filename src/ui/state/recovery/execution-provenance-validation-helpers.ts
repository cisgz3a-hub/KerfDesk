const MAX_TEXT_CHARS = 16_384;

export const MAX_RAW_LINE_CHARS = 4_096;
export const MAX_RAW_LINES = 256;
export const MAX_WARNINGS = 256;

export function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

export function isOptionalProfileSource(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'built-in' ||
    value === 'custom' ||
    value === 'imported' ||
    value === 'lightburn'
  );
}

export function isOptionalUsbId(value: unknown): boolean {
  return value === undefined || (isSafeNonNegativeInteger(value) && value <= 65_535);
}

export function isOptionalRunId(value: unknown): boolean {
  return value === undefined || isRunId(value);
}

export function isRunId(value: unknown): boolean {
  return isBoundedString(value, 1, 200);
}

export function isIsoTimestamp(value: unknown): boolean {
  return isBoundedString(value, 1, 128) && !Number.isNaN(Date.parse(value));
}

export function isBoundedStringArray(value: unknown, maxItems: number, maxChars: number): boolean {
  if (!Array.isArray(value) || value.length > maxItems) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
    if (!isBoundedString(value[index], 0, maxChars)) return false;
  }
  return true;
}

export function isOptionalBoundedString(
  value: unknown,
  minimum: number,
  maximum = MAX_TEXT_CHARS,
): boolean {
  return value === undefined || isBoundedString(value, minimum, maximum);
}

export function isBoundedString(
  value: unknown,
  minimum: number,
  maximum = MAX_TEXT_CHARS,
): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

export function isPositiveInteger(value: unknown): boolean {
  return isSafeNonNegativeInteger(value) && value >= 1;
}

export function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
