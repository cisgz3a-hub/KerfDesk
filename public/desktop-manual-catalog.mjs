/* global TextEncoder */
import { compareCommercialVersions, COMMERCIAL_ORIGIN } from './desktop-commercial-catalog.mjs';
import { MANUAL_DOWNLOAD_PREFIX, verifyManualDownload } from './desktop-manual-download.mjs';

export const MANUAL_CATALOG_KEY = `${MANUAL_DOWNLOAD_PREFIX}/catalog.json`;
export const MANUAL_CATALOG_URL = `${COMMERCIAL_ORIGIN}/${MANUAL_CATALOG_KEY}`;
export const MANUAL_CATALOG_LIMIT = 512 * 1024;
export const MANUAL_CATALOG_RELEASE_LIMIT = 128;

// The index contains the original independently signed immutable manifests.
// It cannot authorize new URLs or releases by supplying unsigned metadata.
export async function verifyManualCatalog(text, keys, now = Date.now()) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MANUAL_CATALOG_LIMIT)
    throw new Error('Invalid manual download catalogue size');
  const catalog = JSON.parse(text);
  if (
    catalog === null ||
    typeof catalog !== 'object' ||
    Array.isArray(catalog) ||
    Object.keys(catalog).sort().join(',') !== 'kind,releases,schemaVersion' ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== 'manual-download-catalog' ||
    !Array.isArray(catalog.releases) ||
    catalog.releases.length > MANUAL_CATALOG_RELEASE_LIMIT
  )
    throw new Error('Invalid manual download catalogue');
  const entries = [];
  const versions = new Set();
  for (const envelope of catalog.releases) {
    const release = await verifyManualDownload(JSON.stringify(envelope), keys, now);
    if (versions.has(release.version)) throw new Error('Duplicate manual download version');
    versions.add(release.version);
    entries.push({ envelope, release });
  }
  return entries.sort((left, right) =>
    compareCommercialVersions(right.release.version, left.release.version),
  );
}
