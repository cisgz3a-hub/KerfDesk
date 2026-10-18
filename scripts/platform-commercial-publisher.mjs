// Publishes one system's macOS or Linux files beside the unsigned Windows
// release of the same version (ADR-610). It never writes a Windows object, the
// Windows latest.json, its catalogue or the release notes: installed Windows
// copies keep reading exactly what the Windows publisher wrote.
import { createPrivateKey, sign } from 'node:crypto';
import { compareCommercialVersions } from '../public/desktop-commercial-catalog.mjs';
import { manualDownloadKey, verifyManualDownload } from '../public/desktop-manual-download.mjs';
import {
  platformArtifactNames,
  platformDownloadKey,
  platformLatestKey,
  platformManifestName,
  validatePlatformDownload,
  verifyPlatformDownload,
} from '../public/desktop-platform-download.mjs';
import {
  CommercialReleaseError,
  digest,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';

const IDENTITY_FIELDS = ['version', 'sourceSha', 'sourceRef', 'publishedAt'];
const same = (a, b) => (a === null ? b === null : Buffer.isBuffer(b) && a.equals(b));
const refuse = (message) => {
  throw new CommercialReleaseError(message);
};

/**
 * The signed payload for one system. `files` maps each exact file name to its
 * bytes; `expected` maps it to the SHA-256 the qualifying job reported, so a
 * file changed after qualification is refused.
 */
export function platformDownloadPayload(identityEnvelope, platform, files, expected, keySet) {
  const identity = verifyCommercialEnvelope(identityEnvelope, keySet, 'release-identity');
  const names = platformArtifactNames(platform, identity.version);
  if (
    !(files instanceof Map) ||
    files.size !== names.length ||
    !names.every((name) => files.has(name)) ||
    !(expected instanceof Map) ||
    expected.size !== names.length
  )
    refuse(`A ${platform} release requires exactly its qualified files.`);
  const artifacts = names.map((name) => {
    const bytes = files.get(name);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 300_000_000)
      refuse(`A ${platform} release file is empty or oversized.`);
    const sha256 = digest(bytes);
    if (expected.get(name) !== sha256)
      refuse(`${name} differs from the file its qualifying job checked.`);
    return { name, bytes: bytes.length, sha256 };
  });
  return validatePlatformDownload({
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'platform-download',
    channel: 'stable',
    platform,
    version: identity.version,
    sourceSha: identity.sourceSha,
    sourceRef: identity.sourceRef,
    publishedAt: identity.publishedAt,
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts,
  });
}

export async function signPlatformDownload(payload, privateKeyPem, keyId, keySet) {
  validatePlatformDownload(payload);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519')
    refuse('A platform release requires an Ed25519 signing key.');
  const bytes = Buffer.from(JSON.stringify(payload));
  const envelope = {
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, key).toString('base64'),
  };
  await verifyPlatformDownload(JSON.stringify(envelope), keySet, payload.platform);
  return envelope;
}

/** The Windows release of this version must already be public with this identity. */
async function requireWindowsRelease(store, payload, keySet) {
  const bytes = await store.get(manualDownloadKey(payload.version, 'download-manifest.json'));
  if (bytes === null)
    refuse(`Publish the Windows release ${payload.version} before its other systems.`);
  let windows;
  try {
    windows = await verifyManualDownload(bytes.toString('utf8'), keySet);
  } catch {
    refuse(`The Windows release ${payload.version} cannot be verified.`);
  }
  if (IDENTITY_FIELDS.some((field) => windows[field] !== payload[field]))
    refuse(`The Windows release ${payload.version} has a different release identity.`);
}

export async function publishPlatformCommercialRelease({
  identity,
  platform,
  files,
  expected,
  store,
  keySet,
  privateKeyPem,
  keyId,
}) {
  const payload = platformDownloadPayload(identity, platform, files, expected, keySet);
  const envelope = await signPlatformDownload(payload, privateKeyPem, keyId, keySet);
  const manifest = Buffer.from(`${JSON.stringify(envelope)}\n`);
  await requireWindowsRelease(store, payload, keySet);
  const latestKey = platformLatestKey(platform);
  const initial = await store.get(latestKey);
  if (initial !== null && !same(initial, manifest)) {
    let previous;
    try {
      previous = await verifyPlatformDownload(initial.toString('utf8'), keySet, platform);
    } catch {
      refuse(`The published ${platform} latest document cannot be verified.`);
    }
    if (
      compareCommercialVersions(payload.version, previous.version) < 0 ||
      Date.parse(payload.publishedAt) < Date.parse(previous.publishedAt)
    )
      refuse(`A ${platform} publication cannot roll back version or release date.`);
    if (payload.version === previous.version)
      refuse(`The published ${platform} version conflicts with this build.`);
  }
  const plan = [
    ...payload.artifacts.map(({ name }) => ({
      key: platformDownloadKey(platform, payload.version, name),
      bytes: files.get(name),
      contentType: 'application/octet-stream',
    })),
    {
      key: platformDownloadKey(platform, payload.version, platformManifestName(platform)),
      bytes: manifest,
      contentType: 'application/json',
    },
  ];
  // Preflight every versioned object before any write; an exact interrupted retry is safe.
  for (const item of plan) {
    const present = await store.get(item.key);
    if (present !== null && !same(present, item.bytes))
      refuse(`Immutable ${platform} download object conflicts with this release.`);
    item.present = present !== null;
  }
  for (const item of plan) {
    if (!item.present)
      await store.put(item.key, item.bytes, {
        contentType: item.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      });
    if (!same(item.bytes, await store.get(item.key)))
      refuse(`${platform} download object readback failed.`);
  }
  // Latest moves last, only from the state checked above.
  if (!same(initial, await store.get(latestKey)))
    refuse(`The ${platform} latest document changed during publication.`);
  if (same(initial, manifest))
    return { status: 'already-published', version: payload.version, latestSha256: digest(manifest) };
  await store.put(latestKey, manifest, { contentType: 'application/json', cacheControl: 'no-store' });
  if (!same(manifest, await store.get(latestKey)))
    refuse(`The ${platform} latest document readback failed.`);
  return { status: 'published', version: payload.version, latestSha256: digest(manifest) };
}
