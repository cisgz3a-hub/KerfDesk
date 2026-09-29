import { isDeepStrictEqual } from 'node:util';
import {
  parseStableFeed,
  validateFeedInstaller,
  stableArtifactNames,
} from './stable-release-artifacts.mjs';
import {
  COMMERCIAL_PREFIX,
  COMMERCIAL_BETA_CATALOG_KEY,
  COMMERCIAL_CATALOG_KEY,
  CommercialReleaseError,
  catalogBytes,
  readCommercialCatalog,
  signCommercialManifest,
  updatePayload,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import {
  EXPECTED_CATALOG,
  catalogState,
  everyRelease,
  requireExpectedCatalog,
  requireForwardRelease,
  sameBytes,
} from './commercial-release-rings.mjs';

const IMMUTABLE = 'public, max-age=31536000, immutable';
export function commercialReleaseFiles(release, identity) {
  const names = stableArtifactNames(identity.version);
  if (
    !Array.isArray(release.files) ||
    release.files.length !== names.length ||
    new Set(release.files.map((file) => file.name)).size !== names.length
  )
    throw new CommercialReleaseError(
      'Commercial release requires exactly three Windows update files.',
    );
  const files = new Map(release.files.map((file) => [file.name, file.bytes]));
  for (const name of names)
    if (
      !Buffer.isBuffer(files.get(name)) ||
      files.get(name).length < 1 ||
      files.get(name).length > 300_000_000
    )
      throw new CommercialReleaseError(`Invalid commercial artifact: ${name}`);
  const feed = parseStableFeed(files.get('latest.yml'));
  if (
    feed.version !== identity.version ||
    feed.packages !== undefined ||
    (feed.files[0].isAdminRightsRequired !== undefined &&
      feed.files[0].isAdminRightsRequired !== false)
  )
    throw new CommercialReleaseError(
      'Commercial feed version, elevation or web-installer contract mismatch.',
    );
  validateFeedInstaller(feed, files.get(names[0]));
  return files;
}

/**
 * Publishes a signed Windows release into the beta ring (ADR-541). Stable
 * clients see it only once promotion copies the same envelope to stable.
 * `expectedCatalogSha256` names the beta catalogue the operator reviewed.
 */
export async function publishCommercialRelease({
  release,
  store,
  keySet,
  privateKeyPem,
  keyId,
  verifyInstaller,
  expectedCatalogSha256,
}) {
  if (typeof verifyInstaller !== 'function')
    throw new CommercialReleaseError('Native installer publisher verification is mandatory.');
  if (typeof expectedCatalogSha256 !== 'string' || !EXPECTED_CATALOG.test(expectedCatalogSha256))
    throw new CommercialReleaseError(
      'The expected commercial catalogue SHA-256, or none, is mandatory.',
    );
  const identity = verifyCommercialEnvelope(release.identity, keySet, 'release-identity');
  const files = commercialReleaseFiles(release, identity);
  const payload = updatePayload(identity, files);
  // Even a retry must supply an authorized matching signing key. This check
  // happens before any storage write and never emits private key material.
  const generated = signCommercialManifest(payload, privateKeyPem, keyId, keySet);
  const installer = files.get(stableArtifactNames(identity.version)[0]);
  await verifyInstaller(installer, 'local');
  const initial = await store.get(COMMERCIAL_BETA_CATALOG_KEY);
  requireExpectedCatalog(initial, keySet, payload, expectedCatalogSha256, 'beta');
  // Beta also lists every stable release, so both rings bound this one.
  const prior = everyRelease(
    readCommercialCatalog(initial, keySet),
    readCommercialCatalog(await store.get(COMMERCIAL_CATALOG_KEY), keySet),
  );
  requireForwardRelease(prior[0]?.payload, identity, 'catalogue');
  const current = prior.find((item) => item.payload.version === identity.version);
  if (current && !isDeepStrictEqual(current.payload, payload))
    throw new CommercialReleaseError('Published commercial version conflicts with this build.');
  const prefix = `${COMMERCIAL_PREFIX}/releases/${identity.version}`;
  const reservationKey = `${prefix}/publication-reservation.json`;
  const reserved = await store.get(reservationKey);
  const envelope = reserved === null ? generated : JSON.parse(reserved.toString('utf8'));
  if (!isDeepStrictEqual(verifyCommercialEnvelope(envelope, keySet), payload))
    throw new CommercialReleaseError(
      'Immutable commercial reservation conflicts with this release.',
    );
  if (current && !isDeepStrictEqual(current.envelope, envelope))
    throw new CommercialReleaseError('Commercial catalogue conflicts with its reserved manifest.');
  const next = catalogBytes(current ? prior : [{ envelope, payload }, ...prior]);
  // Validate the final catalogue before writing any immutable object. Keep every
  // prior eligible version; reaching 64 requires reviewed pagination, not pruning.
  readCommercialCatalog(next, keySet);
  const manifestBytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  await writeImmutableObjects(
    store,
    [
      { key: reservationKey, bytes: reserved ?? manifestBytes },
      ...[...files].map(([name, bytes]) => ({ key: `${prefix}/${name}`, bytes })),
      { key: `${prefix}/update-manifest.json`, bytes: manifestBytes },
    ],
    verifyInstaller,
  );
  // The shared workflow must serialize writers. This comparison is not a
  // distributed lock against an administrator writing directly to the bucket.
  if (!sameBytes(initial, await store.get(COMMERCIAL_BETA_CATALOG_KEY)))
    throw new CommercialReleaseError('Commercial catalogue changed during publication.');
  // The beta catalogue's SHA-256 is what the operator states for the next publication.
  const result = { version: identity.version, catalogSha256: catalogState(next) };
  if (sameBytes(initial, next)) return { status: 'already-published', ...result };
  await store.put(COMMERCIAL_BETA_CATALOG_KEY, next, {
    contentType: 'application/json',
    cacheControl: 'no-store',
  });
  if (!sameBytes(next, await store.get(COMMERCIAL_BETA_CATALOG_KEY)))
    throw new CommercialReleaseError('Commercial catalogue readback failed.');
  return { status: current ? 'already-published' : 'published', ...result };
}

async function writeImmutableObjects(store, plan, verifyInstaller) {
  const present = new Set();
  for (const item of plan) {
    const bytes = await store.get(item.key);
    if (bytes !== null && !bytes.equals(item.bytes))
      throw new CommercialReleaseError(`Immutable commercial object conflict: ${item.key}`);
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
    if (!sameBytes(readback, item.bytes))
      throw new CommercialReleaseError(`Commercial object readback failed: ${item.key}`);
    if (item.key.endsWith('-setup.exe')) await verifyInstaller(readback, 'remote');
  }
}
