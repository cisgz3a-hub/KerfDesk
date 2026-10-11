import { isDeepStrictEqual } from 'node:util';
import { compareCommercialVersions } from '../public/desktop-commercial-catalog.mjs';
import {
  MANUAL_CATALOG_KEY,
  MANUAL_CATALOG_RELEASE_LIMIT,
  verifyManualCatalog,
} from '../public/desktop-manual-catalog.mjs';
import {
  MANUAL_DOWNLOAD_PREFIX,
  manualDownloadKey,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import { CommercialReleaseError } from './commercial-release-manifest.mjs';

const refuse = (message) => {
  throw new CommercialReleaseError(message);
};

async function historicalEntries(store, latest, keys) {
  if (latest === null) return [];
  if (typeof store.list !== 'function') refuse('Manual history requires release object listing.');
  const release = await verifyManualDownload(latest.toString('utf8'), keys);
  const prefix = `${MANUAL_DOWNLOAD_PREFIX}/releases/`;
  const objects = new Set(await store.list(prefix));
  const names = [...objects].filter((name) => name.endsWith('/download-manifest.json'));
  if (names.length > MANUAL_CATALOG_RELEASE_LIMIT)
    refuse('Manual history is full; add reviewed pagination before publishing another release.');
  const entries = [];
  for (const name of names) {
    const bytes = await store.get(name);
    if (bytes === null) refuse('Historical manual manifest disappeared.');
    const prior = await verifyManualDownload(bytes.toString('utf8'), keys);
    if (manualDownloadKey(prior.version, 'download-manifest.json') !== name)
      refuse('Historical manual manifest has a mismatched version path.');
    // An interrupted, not-yet-promoted candidate is not historical publication.
    if (compareCommercialVersions(prior.version, release.version) > 0) continue;
    if (Date.parse(prior.publishedAt) > Date.parse(release.publishedAt))
      refuse('Historical manual release is newer than the published latest date.');
    if (!objects.has(manualDownloadKey(prior.version, prior.artifacts[0].name)))
      refuse('Historical manual installer is missing.');
    entries.push({ envelope: JSON.parse(bytes.toString('utf8')), release: prior });
  }
  if (!entries.some((entry) => entry.release.version === release.version))
    refuse('Published latest has no immutable historical manifest.');
  return entries;
}

/** Backfill once, then retain published history and an identical candidate retry. */
export async function prepareManualHistory(store, latest, envelope, keys) {
  const initial = await store.get(MANUAL_CATALOG_KEY);
  const entries =
    initial === null
      ? await historicalEntries(store, latest, keys)
      : await verifyManualCatalog(initial.toString('utf8'), keys);
  const candidate = await verifyManualDownload(JSON.stringify(envelope), keys);
  const previous =
    latest === null ? null : await verifyManualDownload(latest.toString('utf8'), keys);
  const byVersion = new Map(entries.map((entry) => [entry.release.version, entry]));
  if (previous !== null) {
    const previousEnvelope = JSON.parse(latest.toString('utf8'));
    const archived = byVersion.get(previous.version);
    if (archived && !isDeepStrictEqual(archived.envelope, previousEnvelope))
      refuse('Manual history conflicts with the reviewed latest manifest.');
    byVersion.set(previous.version, { envelope: previousEnvelope, release: previous });
  }
  for (const entry of byVersion.values()) {
    if (compareCommercialVersions(entry.release.version, candidate.version) > 0)
      refuse('Manual history is ahead of this publication.');
    if (entry.release.version === candidate.version && !isDeepStrictEqual(entry.envelope, envelope))
      refuse('Manual history conflicts with this release.');
    // A history-first upload alone did not publish this version. Do not let a
    // later candidate turn an abandoned upload into advertised release history.
    if (
      entry.release.version !== candidate.version &&
      (previous === null || compareCommercialVersions(entry.release.version, previous.version) > 0)
    )
      byVersion.delete(entry.release.version);
  }
  byVersion.set(candidate.version, { envelope, release: candidate });
  const releases = [...byVersion.values()]
    .sort((a, b) => compareCommercialVersions(b.release.version, a.release.version))
    .map((entry) => entry.envelope);
  const next = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, kind: 'manual-download-catalog', releases })}\n`,
  );
  // A size/count limit must never silently prune a customer's covered versions.
  await verifyManualCatalog(next.toString('utf8'), keys);
  return { initial, next };
}
