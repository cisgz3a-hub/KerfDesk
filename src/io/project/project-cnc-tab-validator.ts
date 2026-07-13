type RawObject = Record<string, unknown>;

export function validateCncTabAnchors(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 512) return `missing or invalid \`${path}\``;
  for (let index = 0; index < value.length; index += 1) {
    const error = validateAnchor(value[index], `${path}[${index}]`);
    if (error !== null) return error;
  }
  return null;
}

function validateAnchor(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  if (typeof value['layerColor'] !== 'string') {
    return `missing or invalid \`${path}.layerColor\``;
  }
  if (!isNonNegativeInteger(value['pathIndex'])) {
    return `missing or invalid \`${path}.pathIndex\``;
  }
  if (!isNonNegativeInteger(value['polylineIndex'])) {
    return `missing or invalid \`${path}.polylineIndex\``;
  }
  if (!isNormalizedNumber(value['pathT'])) return `missing or invalid \`${path}.pathT\``;
  return null;
}

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNormalizedNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
