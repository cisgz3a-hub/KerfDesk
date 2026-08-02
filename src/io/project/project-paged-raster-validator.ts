import { validateRasterLumaBase64 } from './project-raster-luma-validator';
import {
  firstError,
  isObject,
  optionalString,
  requireIntegerInRange,
  requireLiteral,
  requirePositiveInteger,
  requireString,
} from './project-shape-primitives';

export function validateRasterSourceContract(
  obj: Record<string, unknown>,
  path: string,
  pixelWidth: number,
  pixelHeight: number,
): string | null {
  const imageAsset = obj['imageAsset'];
  const fieldError = firstError([
    optionalString(obj, `${path}.dataUrl`),
    optionalString(obj, `${path}.lumaBase64`),
    validatePagedRasterImageAsset(imageAsset, `${path}.imageAsset`),
  ]);
  if (fieldError !== null) return fieldError;
  const hasEmbeddedSource = typeof obj['dataUrl'] === 'string';
  const hasPagedSource = isObject(imageAsset);
  if (hasEmbeddedSource === hasPagedSource) {
    return `invalid \`${path}\`: exactly one raster source must be present`;
  }
  if (hasPagedSource) {
    if (obj['lumaBase64'] !== undefined) {
      return `invalid \`${path}\`: page-backed rasters cannot embed lumaBase64`;
    }
    if (
      imageAsset['sampledWidth'] !== pixelWidth ||
      imageAsset['sampledHeight'] !== pixelHeight ||
      imageAsset['lumaByteLength'] !== pixelWidth * pixelHeight
    ) {
      return `invalid \`${path}.imageAsset\`: sampled dimensions or luma length do not match the raster`;
    }
  }
  const lumaBase64 = obj['lumaBase64'];
  return typeof lumaBase64 === 'string'
    ? validateRasterLumaBase64(lumaBase64, pixelWidth * pixelHeight, path)
    : null;
}

function validatePagedRasterImageAsset(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const thumbnail = value['thumbnail'];
  if (!isObject(thumbnail)) return `missing or invalid \`${path}.thumbnail\``;
  return firstError([
    requireIntegerInRange(value, `${path}.schemaVersion`, 1, 1),
    requireLiteral(value, `${path}.repository`, ['curvedesk-import-assets-v1']),
    requireString(value, `${path}.sourceAssetId`),
    requireString(value, `${path}.lumaAssetId`),
    requireString(value, `${path}.sourceMimeType`),
    requirePositiveInteger(value, `${path}.sourceByteLength`),
    requirePositiveInteger(value, `${path}.lumaByteLength`),
    requirePositiveInteger(value, `${path}.naturalWidth`),
    requirePositiveInteger(value, `${path}.naturalHeight`),
    requirePositiveInteger(value, `${path}.sampledWidth`),
    requirePositiveInteger(value, `${path}.sampledHeight`),
    requireLiteral(thumbnail, `${path}.thumbnail.mimeType`, ['image/bmp']),
    requireString(thumbnail, `${path}.thumbnail.dataUrl`),
    requirePositiveInteger(thumbnail, `${path}.thumbnail.width`),
    requirePositiveInteger(thumbnail, `${path}.thumbnail.height`),
  ]);
}
