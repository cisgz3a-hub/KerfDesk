type RawObject = Record<string, unknown>;

// Structure only, deliberately with no length limit. Anchors seed per closed
// contour rather than per object, and an SVG import buckets every same-colour
// contour into one object, so a large nest legitimately carries thousands: a
// 140-part profile-outside layer at the default 4 tabs/shape is 560 anchors.
// The old `length > 512` clause was a policy cap wearing a shape check's
// clothes, and it made those projects unsavable through Ctrl+S, Save As and
// autosave alike - with a salvage copy that could not be reopened.
export function validateCncTabAnchors(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
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
