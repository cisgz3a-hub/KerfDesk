// Beta probation starts only after the signed catalogue is publicly visible.
// Keep this signed receipt separate from the release identity: licence update
// eligibility must continue to use the original cut date (ADR-541).
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import {
  CATALOG_LIMIT,
  COMMERCIAL_BETA_CATALOG_KEY,
  COMMERCIAL_PREFIX,
  CommercialReleaseError,
  digest,
  readCommercialCatalog,
  stablePublicKeys,
} from './commercial-release-manifest.mjs';

const ORIGIN = 'https://dl.kerfdesk.com';
const RECEIPT_LIMIT = 8192;
const exact = (value, names) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');
const refuse = (message) => {
  throw new CommercialReleaseError(`Beta observation ${message}.`);
};
const manifestDigest = (entry) => digest(Buffer.from(JSON.stringify(entry.envelope)));

export function betaObservationKey(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
    refuse('requires a stable version');
  return `${COMMERCIAL_PREFIX}/releases/${version}/beta-observation.json`;
}

/** Missing evidence never borrows the prebuild identity's date. */
export function readBetaObservation(bytes, entry, keySet, now = new Date()) {
  if (bytes === null) return null;
  if (!Buffer.isBuffer(bytes) || bytes.length > RECEIPT_LIMIT) refuse('receipt is too large');
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !exact(envelope, ['schemaVersion', 'keyId', 'algorithm', 'payload', 'signature']) ||
    envelope.schemaVersion !== 1 ||
    envelope.algorithm !== 'Ed25519'
  )
    refuse('receipt has invalid fields');
  const keys = stablePublicKeys(keySet);
  if (typeof envelope.keyId !== 'string' || !Object.hasOwn(keys, envelope.keyId))
    refuse('receipt has an untrusted key');
  if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string')
    refuse('receipt has invalid signed bytes');
  const payloadBytes = Buffer.from(envelope.payload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  const key = createPublicKey({
    key: Buffer.from(keys[envelope.keyId], 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (
    payloadBytes.toString('base64') !== envelope.payload ||
    signature.toString('base64') !== envelope.signature ||
    signature.length !== 64 ||
    !verify(null, payloadBytes, key, signature)
  )
    refuse('receipt signature is invalid');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  if (
    !exact(value, [
      'schemaVersion',
      'kind',
      'version',
      'sourceSha',
      'manifestSha256',
      'observedAt',
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'beta-observation' ||
    value.version !== entry.payload.version ||
    value.sourceSha !== entry.payload.sourceSha ||
    value.manifestSha256 !== manifestDigest(entry)
  )
    refuse('receipt does not match the published release');
  const time = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : NaN;
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== value.observedAt ||
    time < Date.parse(entry.payload.publishedAt) ||
    time > now.getTime() + 300_000
  )
    refuse('receipt has an invalid observation time');
  return value.observedAt;
}

export async function readPublicBetaEvidence(key, limit, fetchImpl = fetch) {
  const response = await fetchImpl(`${ORIGIN}/${key}`, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    refuse('public evidence is unavailable');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) refuse('public evidence exceeds its limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function publicBetaObservedAt(entry, keySet, now, fetchImpl = fetch) {
  return readBetaObservation(
    await readPublicBetaEvidence(
      betaObservationKey(entry.payload.version),
      RECEIPT_LIMIT,
      fetchImpl,
    ),
    entry,
    keySet,
    now,
  );
}

/** An interrupted write can delay probation, but cannot move its start earlier. */
export async function recordBetaObservation({
  store,
  keySet,
  privateKeyPem,
  keyId,
  version,
  expectedCatalogSha256,
  fetchImpl = fetch,
  clock = () => new Date(),
}) {
  const catalog = await store.get(COMMERCIAL_BETA_CATALOG_KEY);
  if (
    !/^[a-f0-9]{64}$/u.test(expectedCatalogSha256 ?? '') ||
    catalog === null ||
    digest(catalog) !== expectedCatalogSha256
  )
    refuse('requires the reviewed beta catalogue SHA-256');
  const entry = readCommercialCatalog(catalog, keySet)[0];
  if (entry?.payload.version !== version) refuse('requires the newest published beta');
  const receiptKey = betaObservationKey(version);
  const existing = await store.get(receiptKey);
  if (existing !== null) return readBetaObservation(existing, entry, keySet, clock());
  const visible = readCommercialCatalog(
    await readPublicBetaEvidence(COMMERCIAL_BETA_CATALOG_KEY, CATALOG_LIMIT, fetchImpl),
    keySet,
  )[0];
  if (!visible || manifestDigest(visible) !== manifestDigest(entry))
    refuse('requires the exact newest beta on the public download host');
  const observedAt = clock().toISOString();
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: 'beta-observation',
      version,
      sourceSha: entry.payload.sourceSha,
      manifestSha256: manifestDigest(entry),
      observedAt,
    }),
  );
  const bytes = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 1,
      keyId,
      algorithm: 'Ed25519',
      payload: payload.toString('base64'),
      signature: sign(null, payload, createPrivateKey(privateKeyPem)).toString('base64'),
    })}\n`,
  );
  readBetaObservation(bytes, entry, keySet, clock());
  // The commercial publication workflow owns the shared writer lock.
  const current = await store.get(COMMERCIAL_BETA_CATALOG_KEY);
  if (!current?.equals(catalog)) refuse('catalogue changed before recording visibility');
  const raced = await store.get(receiptKey);
  if (raced !== null) return readBetaObservation(raced, entry, keySet, clock());
  await store.put(receiptKey, bytes, {
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  if (!(await store.get(receiptKey))?.equals(bytes)) refuse('receipt readback failed');
  return observedAt;
}
