import {
  firstError,
  isObject,
  optionalString,
  requireIntegerInRange,
} from './project-shape-primitives';

export function validateLibraryAssetProvenance(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireIntegerInRange(value, `${path}.schemaVersion`, 1, 1),
    requireNonBlankString(value['assetId'], `${path}.assetId`),
    requireNonBlankString(value['title'], `${path}.title`),
    requireNonBlankString(value['sourceName'], `${path}.sourceName`),
    requireNonBlankString(value['licenseId'], `${path}.licenseId`),
    optionalString(value, `${path}.creator`),
    optionalString(value, `${path}.sourceUrl`),
    optionalString(value, `${path}.licenseUrl`),
    optionalString(value, `${path}.sourceVersion`),
    optionalString(value, `${path}.assetHash`),
  ]);
}

function requireNonBlankString(value: unknown, path: string): string | null {
  return typeof value === 'string' && value.trim() !== '' ? null : `missing or invalid \`${path}\``;
}
