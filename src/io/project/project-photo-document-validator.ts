import {
  MAX_PHOTO_EDITOR_DOCUMENT_BYTES,
  MAX_PHOTO_EDITOR_LAYERS,
  PHOTO_EDITOR_BLENDS,
} from '../../core/scene/photo-editor-document';
import {
  firstError,
  isObject,
  requireBoolean,
  requireIntegerInRange,
  requireLiteral,
  requirePositiveInteger,
  requireString,
} from './project-shape-primitives';

export function validatePhotoEditorDocument(
  value: unknown,
  path: string,
  pixelWidth: number,
  pixelHeight: number,
): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const fieldError = firstError([
    requireIntegerInRange(value, `${path}.version`, 1, 1),
    requirePositiveInteger(value, `${path}.width`),
    requirePositiveInteger(value, `${path}.height`),
    requireString(value, `${path}.activeLayerId`),
  ]);
  if (fieldError !== null) return fieldError;
  if (value['width'] !== pixelWidth || value['height'] !== pixelHeight)
    return `invalid \`${path}\`: dimensions must match the raster`;
  const layers = value['layers'];
  if (!Array.isArray(layers) || layers.length === 0 || layers.length > MAX_PHOTO_EDITOR_LAYERS)
    return `invalid \`${path}.layers\`: expected 1..${MAX_PHOTO_EDITOR_LAYERS} layers`;
  const layerBytes = pixelWidth * pixelHeight * 4;
  if (layerBytes * layers.length > MAX_PHOTO_EDITOR_DOCUMENT_BYTES)
    return `invalid \`${path}\`: decoded layers exceed ${MAX_PHOTO_EDITOR_DOCUMENT_BYTES} bytes`;
  return validateLayers(layers, value['activeLayerId'], layerBytes, path);
}

function validateLayers(
  layers: ReadonlyArray<unknown>,
  activeLayerId: unknown,
  layerBytes: number,
  path: string,
): string | null {
  const ids = new Set<string>();
  for (const [index, layer] of layers.entries()) {
    const layerPath = `${path}.layers[${index}]`;
    if (!isObject(layer)) return `invalid \`${layerPath}\``;
    const error = validateLayer(layer, layerBytes, layerPath);
    if (error !== null) return error;
    const id = layer['id'] as string;
    if (ids.has(id)) return `invalid \`${layerPath}.id\`: duplicate layer id`;
    ids.add(id);
  }
  return typeof activeLayerId === 'string' && ids.has(activeLayerId)
    ? null
    : `invalid \`${path}.activeLayerId\`: missing layer`;
}

function validateLayer(layer: Record<string, unknown>, bytes: number, path: string): string | null {
  const opacity = layer['opacity'];
  const id = layer['id'];
  return firstError([
    typeof id === 'string' && id.trim().length > 0 ? null : `invalid \`${path}.id\``,
    requireString(layer, `${path}.name`),
    requireBoolean(layer, `${path}.isVisible`),
    typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1
      ? null
      : `invalid \`${path}.opacity\``,
    requireLiteral(layer, `${path}.blend`, PHOTO_EDITOR_BLENDS),
    validRgbaBase64(layer['rgbaBase64'], bytes) ? null : `invalid \`${path}.rgbaBase64\``,
  ]);
}

function validRgbaBase64(value: unknown, bytes: number): boolean {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(bytes / 3)) return false;
  const padding = (3 - (bytes % 3)) % 3;
  const end = value.length - padding;
  let lastDigit = 0;
  // Scan in place: no decoded allocation or multi-megabyte regular-expression stack.
  for (let index = 0; index < end; index++) {
    lastDigit = base64Digit(value.charCodeAt(index));
    if (lastDigit < 0) return false;
  }
  if (padding === 2 && (lastDigit & 15) !== 0) return false;
  if (padding === 1 && (lastDigit & 3) !== 0) return false;
  return value.slice(end) === '='.repeat(padding);
}

function base64Digit(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  return code === 47 ? 63 : -1;
}
