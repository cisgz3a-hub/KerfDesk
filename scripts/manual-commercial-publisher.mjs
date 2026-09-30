import { compareCommercialVersions } from '../public/desktop-commercial-catalog.mjs';
import {
  MANUAL_DOWNLOAD_LATEST_KEY,
  manualDownloadKey,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import { CommercialReleaseError, digest } from './commercial-release-manifest.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';

const same = (a, b) => (a === null ? b === null : Buffer.isBuffer(b) && a.equals(b));
const state = (bytes) => (bytes === null ? 'none' : digest(bytes));
const refuse = (message) => {
  throw new CommercialReleaseError(message);
};

/** Separate manual-only lane. Requires serialized operators; never writes an update feed/catalogue. */
export async function publishManualCommercialRelease({
  identity,
  installer,
  store,
  keySet,
  privateKeyPem,
  keyId,
  verifyInstaller,
  expectedLatestSha256,
}) {
  if (typeof verifyInstaller !== 'function')
    refuse('Unsigned commercial package verification is mandatory.');
  if (!/^(?:none|[a-f0-9]{64})$/u.test(expectedLatestSha256 ?? ''))
    refuse('The reviewed manual latest SHA-256, or none, is mandatory.');
  const payload = manualDownloadPayload(identity, installer, keySet);
  const envelope = await signManualDownload(payload, privateKeyPem, keyId, keySet);
  const manifest = Buffer.from(`${JSON.stringify(envelope)}\n`);
  await verifyInstaller(installer, 'local');
  const initial = await store.get(MANUAL_DOWNLOAD_LATEST_KEY);
  if (!same(initial, manifest) && state(initial) !== expectedLatestSha256)
    refuse('Manual download latest changed from the reviewed state.');
  if (initial !== null) {
    const previous = await verifyManualDownload(initial.toString('utf8'), keySet);
    if (
      compareCommercialVersions(payload.version, previous.version) < 0 ||
      Date.parse(payload.publishedAt) < Date.parse(previous.publishedAt)
    )
      refuse('Manual download publication cannot roll back version or release date.');
    if (payload.version === previous.version && !same(initial, manifest))
      refuse('The published manual version conflicts with this build.');
  }
  const plan = [
    { key: manualDownloadKey(payload.version, payload.artifacts[0].name), bytes: installer },
    { key: manualDownloadKey(payload.version, 'download-manifest.json'), bytes: manifest },
  ];
  // Preflight every versioned object before any write; exact interrupted retries are safe.
  for (const item of plan) {
    const present = await store.get(item.key);
    if (present !== null && !same(present, item.bytes))
      refuse('Immutable manual download object conflicts with this release.');
    item.present = present !== null;
  }
  for (const item of plan) {
    if (!item.present)
      await store.put(item.key, item.bytes, {
        contentType: item.key.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    const readback = await store.get(item.key);
    if (!same(readback, item.bytes)) refuse('Manual download object readback failed.');
    if (item.key.endsWith('.exe')) await verifyInstaller(readback, 'remote');
  }
  if (!same(initial, await store.get(MANUAL_DOWNLOAD_LATEST_KEY)))
    refuse('Manual download latest changed during publication.');
  if (same(initial, manifest))
    return {
      status: 'already-published',
      version: payload.version,
      latestSha256: digest(manifest),
    };
  await store.put(MANUAL_DOWNLOAD_LATEST_KEY, manifest, {
    contentType: 'application/json',
    cacheControl: 'no-store',
  });
  if (!same(manifest, await store.get(MANUAL_DOWNLOAD_LATEST_KEY)))
    refuse('Manual download latest readback failed.');
  return { status: 'published', version: payload.version, latestSha256: digest(manifest) };
}
