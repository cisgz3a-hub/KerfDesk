import type { LibraryAssetProvenance } from '../../core/scene/scene-object';
import { isObject } from './project-shape-primitives';

type RequiredProvenanceFields = Pick<
  LibraryAssetProvenance,
  'assetId' | 'title' | 'sourceName' | 'licenseId'
>;
type OptionalProvenanceKey = 'creator' | 'sourceUrl' | 'licenseUrl' | 'sourceVersion' | 'assetHash';
const OPTIONAL_PROVENANCE_KEYS: ReadonlyArray<OptionalProvenanceKey> = [
  'creator',
  'sourceUrl',
  'licenseUrl',
  'sourceVersion',
  'assetHash',
];

// Library provenance is display/audit metadata, never load-bearing project
// geometry. Rebuild only the schema we understand and drop anything malformed
// or newer so a stale/foreign optional snapshot cannot refuse a project load.
export function normalizeLibraryAssetProvenance(
  value: unknown,
): LibraryAssetProvenance | undefined {
  if (!isObject(value) || value['schemaVersion'] !== 1) return undefined;
  const required = requiredFields(value);
  if (required === undefined) return undefined;
  const optional = optionalFields(value);
  if (optional === undefined) return undefined;

  return {
    schemaVersion: 1,
    ...required,
    ...optional,
  };
}

function requiredNonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function requiredFields(value: Record<string, unknown>): RequiredProvenanceFields | undefined {
  const assetId = requiredNonBlankString(value['assetId']);
  const title = requiredNonBlankString(value['title']);
  const sourceName = requiredNonBlankString(value['sourceName']);
  const licenseId = requiredNonBlankString(value['licenseId']);
  if (assetId === undefined || title === undefined) return undefined;
  if (sourceName === undefined || licenseId === undefined) return undefined;
  return { assetId, title, sourceName, licenseId };
}

function optionalFields(
  value: Record<string, unknown>,
): Partial<Pick<LibraryAssetProvenance, OptionalProvenanceKey>> | undefined {
  const result: Partial<Record<OptionalProvenanceKey, string>> = {};
  for (const key of OPTIONAL_PROVENANCE_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'string') return undefined;
    result[key] = candidate;
  }
  return result;
}
