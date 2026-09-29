import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
  comparePreviewVersions,
  previewArtifactNames,
  PREVIEW_PREFIX,
  validatePreviewPayload,
  verifyPreviewManifest,
} from '../public/desktop-release-manifest.mjs';

export const PREVIEW_LATEST_KEY = `${PREVIEW_PREFIX}/latest.json`;
const IMMUTABLE = {
  contentType: 'application/octet-stream',
  cacheControl: 'public, max-age=31536000, immutable',
};
const JSON_METADATA = { contentType: 'application/json', cacheControl: IMMUTABLE.cacheControl };
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function signPreviewManifest(payload, privateKeyPem, keyId) {
  validatePreviewPayload(payload);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Preview signing key must be Ed25519.');
  const bytes = Buffer.from(JSON.stringify(payload));
  return Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, keyId, algorithm: 'Ed25519', payload: bytes.toString('base64'), signature: sign(null, bytes, key).toString('base64') })}\n`,
  );
}

function artifactIdentity(files, version) {
  const expected = previewArtifactNames(version);
  if (
    files.length !== expected.length ||
    new Set(files.map((file) => file.name)).size !== files.length
  )
    throw new Error('Preview artifact set is incomplete or duplicated.');
  return expected.map((name) => {
    const file = files.find((candidate) => candidate.name === name);
    if (
      !file ||
      !Buffer.isBuffer(file.bytes) ||
      file.bytes.length < 1 ||
      file.bytes.length > 300_000_000
    )
      throw new Error(`Invalid Preview artifact: ${name}`);
    return { name, bytes: file.bytes.length, sha256: sha256(file.bytes) };
  });
}
const sameBytes = (left, right) =>
  left === null ? right === null : right !== null && left.equals(right);
const identity = (payload) =>
  JSON.stringify({
    version: payload.version,
    sourceSha: payload.sourceSha,
    sourceRef: payload.sourceRef,
    publishedAt: payload.publishedAt,
    artifacts: [...payload.artifacts].sort((a, b) => a.name.localeCompare(b.name)),
  });

// This is a serialized workflow publisher, not a distributed lock. An external
// administrator could write between the last comparison and pointer promotion.
export async function publishPreviewRelease({ release, store, keySet, privateKeyPem, keyId }) {
  const payload = validatePreviewPayload({
    ...release.metadata,
    artifacts: artifactIdentity(release.files, release.metadata.version),
  });
  const before = await store.get(PREVIEW_LATEST_KEY);
  let previous = null;
  if (before !== null) {
    previous = await verifyPreviewManifest(before.toString('utf8'), keySet);
    if (comparePreviewVersions(previous.version, payload.version) > 0)
      throw new Error('A newer Preview is already published; rollback refused.');
    if (previous.version === payload.version && identity(previous) !== identity(payload))
      throw new Error('Published Preview version has different artifact bytes or source.');
  }
  const prefix = `${PREVIEW_PREFIX}/${payload.version}`;
  const manifestKey = `${prefix}/release.json`;
  const reservationKey = `${prefix}/publication-reservation.json`;
  const reserved = await store.get(reservationKey);
  // Reuse the original signed identity on a rerun; timestamps/run IDs must never
  // rewrite the immutable version. The complete bytes are still checked below.
  const envelope = reserved ?? signPreviewManifest(payload, privateKeyPem, keyId);
  const verified = await verifyPreviewManifest(envelope.toString('utf8'), keySet);
  if (identity(verified) !== identity(payload))
    throw new Error('Immutable Preview manifest conflicts with this release.');
  const plan = [
    { key: reservationKey, bytes: envelope, metadata: JSON_METADATA },
    ...release.files.map((file) => ({
      key: `${prefix}/${file.name}`,
      bytes: file.bytes,
      metadata: {
        ...IMMUTABLE,
        contentType:
          file.name.endsWith('.md') || file.name.endsWith('.txt')
            ? 'text/plain; charset=utf-8'
            : file.name.endsWith('.json')
              ? 'application/json'
              : IMMUTABLE.contentType,
      },
    })),
    // Exact-version consumers also get a complete release: their manifest only
    // appears after all artifact bytes were staged and read back successfully.
    { key: manifestKey, bytes: envelope, metadata: JSON_METADATA },
  ];
  // Preflight *all* immutable objects before the first write. Partial retries
  // may fill missing objects, but never overwrite a conflicting release byte.
  const existing = new Map();
  for (const item of plan) {
    const bytes = await store.get(item.key);
    if (bytes !== null && !bytes.equals(item.bytes))
      throw new Error(`Immutable Preview object conflict: ${item.key}`);
    existing.set(item.key, bytes);
  }
  for (const item of plan) {
    if (existing.get(item.key) === null) await store.put(item.key, item.bytes, item.metadata);
    const readback = await store.get(item.key);
    if (!sameBytes(readback, item.bytes))
      throw new Error(`Preview object readback failed: ${item.key}`);
  }
  const current = await store.get(PREVIEW_LATEST_KEY);
  if (!sameBytes(before, current))
    throw new Error('Preview pointer changed during publication; refusing to promote.');
  if (previous?.version === payload.version) {
    if (!before.equals(envelope))
      throw new Error('Published Preview pointer conflicts with immutable manifest.');
    return { status: 'already-published', version: payload.version };
  }
  // The only mutable object moves last, after every versioned byte was verified.
  await store.put(PREVIEW_LATEST_KEY, envelope, {
    contentType: 'application/json',
    cacheControl: 'no-store',
  });
  if (!sameBytes(await store.get(PREVIEW_LATEST_KEY), envelope))
    throw new Error('Preview pointer readback failed.');
  return { status: 'published', version: payload.version };
}
