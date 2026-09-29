import { isDeepStrictEqual } from 'node:util';
import {
  parseStableFeed,
  validateFeedInstaller,
  stableArtifactNames,
  compareStableVersions,
} from './stable-release-artifacts.mjs';
import {
  COMMERCIAL_PREFIX,
  COMMERCIAL_CATALOG_KEY,
  catalogBytes,
  readCommercialCatalog,
  signCommercialManifest,
  updatePayload,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const same = (a, b) => (a === null ? b === null : b !== null && a.equals(b));
export function commercialReleaseFiles(release, identity) {
  const names = stableArtifactNames(identity.version);
  if (
    !Array.isArray(release.files) ||
    release.files.length !== names.length ||
    new Set(release.files.map((file) => file.name)).size !== names.length
  )
    throw new Error('Commercial release requires exactly three Windows update files.');
  const files = new Map(release.files.map((file) => [file.name, file.bytes]));
  for (const name of names)
    if (
      !Buffer.isBuffer(files.get(name)) ||
      files.get(name).length < 1 ||
      files.get(name).length > 300_000_000
    )
      throw new Error(`Invalid commercial artifact: ${name}`);
  const feed = parseStableFeed(files.get('latest.yml'));
  if (
    feed.version !== identity.version ||
    feed.packages !== undefined ||
    (feed.files[0].isAdminRightsRequired !== undefined &&
      feed.files[0].isAdminRightsRequired !== false)
  )
    throw new Error('Commercial feed version, elevation or web-installer contract mismatch.');
  validateFeedInstaller(feed, files.get(names[0]));
  return files;
}

export async function publishCommercialRelease({
  release,
  store,
  keySet,
  privateKeyPem,
  keyId,
  verifyInstaller,
}) {
  if (typeof verifyInstaller !== 'function')
    throw new Error('Native installer publisher verification is mandatory.');
  const identity = verifyCommercialEnvelope(release.identity, keySet, 'release-identity');
  const files = commercialReleaseFiles(release, identity);
  const payload = updatePayload(identity, files);
  // Even a retry must supply an authorized matching signing key. This check
  // happens before any storage write and never emits private key material.
  const generated = signCommercialManifest(payload, privateKeyPem, keyId, keySet);
  const installer = files.get(stableArtifactNames(identity.version)[0]);
  await verifyInstaller(installer, 'local');
  const initial = await store.get(COMMERCIAL_CATALOG_KEY);
  const prior = readCommercialCatalog(initial, keySet);
  const latest = prior[0]?.payload;
  if (latest && compareStableVersions(latest.version, identity.version) > 0)
    throw new Error('Refusing commercial catalogue rollback.');
  if (latest && Date.parse(identity.publishedAt) < Date.parse(latest.publishedAt))
    throw new Error('Commercial publication date cannot precede the current release.');
  const current = prior.find((item) => item.payload.version === identity.version);
  if (current && !isDeepStrictEqual(current.payload, payload))
    throw new Error('Published commercial version conflicts with this build.');
  const prefix = `${COMMERCIAL_PREFIX}/releases/${identity.version}`;
  const reservationKey = `${prefix}/publication-reservation.json`;
  const reserved = await store.get(reservationKey);
  const envelope = reserved === null ? generated : JSON.parse(reserved.toString('utf8'));
  if (!isDeepStrictEqual(verifyCommercialEnvelope(envelope, keySet), payload))
    throw new Error('Immutable commercial reservation conflicts with this release.');
  if (current && !isDeepStrictEqual(current.envelope, envelope))
    throw new Error('Commercial catalogue conflicts with its reserved manifest.');
  const next = current ? initial : catalogBytes([{ envelope, payload }, ...prior]);
  // Validate the final catalogue before writing any immutable object. Keep every
  // prior eligible version; reaching 64 requires reviewed pagination, not pruning.
  readCommercialCatalog(next, keySet);
  const manifestBytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  const plan = [
    { key: reservationKey, bytes: reserved ?? manifestBytes },
    ...[...files].map(([name, bytes]) => ({ key: `${prefix}/${name}`, bytes })),
    { key: `${prefix}/update-manifest.json`, bytes: manifestBytes },
  ];
  const present = new Set();
  for (const item of plan) {
    const bytes = await store.get(item.key);
    if (bytes !== null && !bytes.equals(item.bytes))
      throw new Error(`Immutable commercial object conflict: ${item.key}`);
    if (bytes !== null) present.add(item.key);
  }
  for (const item of plan) {
    if (!present.has(item.key))
      await store.put(item.key, item.bytes, {
        contentType: item.key.endsWith('.json')
          ? 'application/json'
          : item.key.endsWith('.yml')
            ? 'text/yaml'
            : 'application/octet-stream',
        cacheControl: IMMUTABLE,
      });
    const readback = await store.get(item.key);
    if (!same(readback, item.bytes))
      throw new Error(`Commercial object readback failed: ${item.key}`);
    if (item.key.endsWith('-setup.exe')) await verifyInstaller(readback, 'remote');
  }
  // The shared workflow must serialize writers. This comparison is not a
  // distributed lock against an administrator writing directly to the bucket.
  if (!same(initial, await store.get(COMMERCIAL_CATALOG_KEY)))
    throw new Error('Commercial catalogue changed during publication.');
  if (current) return { status: 'already-published', version: identity.version };
  await store.put(COMMERCIAL_CATALOG_KEY, next, {
    contentType: 'application/json',
    cacheControl: 'no-store',
  });
  if (!same(next, await store.get(COMMERCIAL_CATALOG_KEY)))
    throw new Error('Commercial catalogue readback failed.');
  return { status: 'published', version: identity.version };
}
