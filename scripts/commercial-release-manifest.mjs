import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { compareStableVersions, stableArtifactNames } from './stable-release-artifacts.mjs';

export const COMMERCIAL_PREFIX = 'desktop/commercial';
export const COMMERCIAL_CATALOG_KEY = `${COMMERCIAL_PREFIX}/catalog.json`;
export const CATALOG_LIMIT = 256 * 1024;
const VERSION = /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})$/u;
const IDENTITY_FIELDS = [
  'schemaVersion',
  'product',
  'kind',
  'channel',
  'version',
  'sourceSha',
  'sourceRef',
  'publishedAt',
];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) =>
  record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid commercial release: ${message}`);
}
export const digest = (bytes, algorithm = 'sha256') =>
  createHash(algorithm)
    .update(bytes)
    .digest(algorithm === 'sha256' ? 'hex' : 'base64');

function base64(value, limit = 65_536) {
  requireValue(
    typeof value === 'string' && value.length > 0 && value.length <= limit,
    'base64 length',
  );
  const bytes = Buffer.from(value, 'base64');
  requireValue(bytes.toString('base64') === value, 'canonical base64');
  return bytes;
}
export function stablePublicKeys(keySet) {
  requireValue(
    record(keySet) && keySet.schemaVersion === 1 && Array.isArray(keySet.keys),
    'trust anchors',
  );
  const keys = keySet.keys.filter((key) => key?.channel === 'stable');
  requireValue(keys.length > 0 && keys.length <= 8, 'stable trust anchors');
  const result = {};
  for (const key of keys) {
    requireValue(
      typeof key.keyId === 'string' &&
        /^[a-zA-Z0-9_-]{1,80}$/u.test(key.keyId) &&
        !Object.hasOwn(result, key.keyId) &&
        key.algorithm === 'Ed25519',
      'key identity',
    );
    const parsed = createPublicKey({
      key: base64(key.publicKeySpki, 1024),
      format: 'der',
      type: 'spki',
    });
    requireValue(parsed.asymmetricKeyType === 'ed25519', 'key type');
    Object.defineProperty(result, key.keyId, { value: key.publicKeySpki, enumerable: true });
  }
  return result;
}
export function validateCommercialPayload(value, kind, now = Date.now()) {
  requireValue(
    exact(value, kind === 'update-manifest' ? [...IDENTITY_FIELDS, 'artifacts'] : IDENTITY_FIELDS),
    'payload fields',
  );
  requireValue(
    value.schemaVersion === 1 &&
      value.product === 'kerfdesk-desktop' &&
      value.kind === kind &&
      value.channel === 'stable',
    'payload identity',
  );
  requireValue(typeof value.version === 'string' && VERSION.test(value.version), 'version');
  requireValue(
    typeof value.sourceSha === 'string' &&
      /^[a-f0-9]{40}$/u.test(value.sourceSha) &&
      value.sourceRef === `refs/tags/v${value.version}`,
    'source',
  );
  const time = typeof value.publishedAt === 'string' ? Date.parse(value.publishedAt) : NaN;
  requireValue(
    Number.isFinite(time) &&
      time > 0 &&
      new Date(time).toISOString() === value.publishedAt &&
      time <= now + 300_000,
    'publication timestamp',
  );
  if (kind === 'update-manifest') {
    const names = stableArtifactNames(value.version);
    requireValue(Array.isArray(value.artifacts) && value.artifacts.length === 3, 'artifact count');
    const seen = new Set();
    for (const item of value.artifacts) {
      requireValue(
        exact(item, ['name', 'bytes', 'sha256', 'sha512']) &&
          names.includes(item.name) &&
          !seen.has(item.name),
        'artifact identity',
      );
      seen.add(item.name);
      requireValue(
        Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 300_000_000,
        'artifact size',
      );
      requireValue(
        typeof item.sha256 === 'string' &&
          /^[a-f0-9]{64}$/u.test(item.sha256) &&
          base64(item.sha512, 88).length === 64,
        'artifact digest',
      );
    }
  }
  return value;
}
export function verifyCommercialEnvelope(envelope, keySet, kind = 'update-manifest') {
  requireValue(
    exact(envelope, ['schemaVersion', 'keyId', 'algorithm', 'payload', 'signature']) &&
      envelope.schemaVersion === 1 &&
      envelope.algorithm === 'Ed25519',
    'signature envelope',
  );
  const keys = stablePublicKeys(keySet);
  requireValue(
    typeof envelope.keyId === 'string' && Object.hasOwn(keys, envelope.keyId),
    'untrusted signing key',
  );
  const payload = base64(envelope.payload);
  const signature = base64(envelope.signature, 88);
  const key = createPublicKey({ key: base64(keys[envelope.keyId]), format: 'der', type: 'spki' });
  requireValue(signature.length === 64 && verify(null, payload, key, signature), 'signature');
  return validateCommercialPayload(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)),
    kind,
  );
}
export function updatePayload(identity, files) {
  const result = Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, identity[field]]));
  result.kind = 'update-manifest';
  result.artifacts = stableArtifactNames(identity.version).map((name) => {
    const bytes = files.get(name);
    return { name, bytes: bytes.length, sha256: digest(bytes), sha512: digest(bytes, 'sha512') };
  });
  return validateCommercialPayload(result, 'update-manifest');
}
export function signCommercialManifest(payload, privateKeyPem, keyId, keySet) {
  validateCommercialPayload(payload, 'update-manifest');
  const key = createPrivateKey(privateKeyPem);
  requireValue(key.asymmetricKeyType === 'ed25519', 'private key type');
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const envelope = {
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: payloadBytes.toString('base64'),
    signature: sign(null, payloadBytes, key).toString('base64'),
  };
  verifyCommercialEnvelope(envelope, keySet);
  return envelope;
}
export function readCommercialCatalog(bytes, keySet) {
  if (bytes === null) return [];
  requireValue(Buffer.isBuffer(bytes) && bytes.length <= CATALOG_LIMIT, 'catalog size');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  requireValue(
    exact(value, ['schemaVersion', 'releases']) &&
      value.schemaVersion === 1 &&
      Array.isArray(value.releases) &&
      value.releases.length <= 64,
    'catalog shape',
  );
  const seen = new Set();
  const entries = value.releases.map((envelope) => {
    const payload = verifyCommercialEnvelope(envelope, keySet);
    requireValue(!seen.has(payload.version), 'duplicate catalog version');
    seen.add(payload.version);
    return { envelope, payload };
  });
  return entries.sort((a, b) => compareStableVersions(b.payload.version, a.payload.version));
}
export function catalogBytes(entries) {
  requireValue(
    entries.length <= 64,
    'catalog capacity; implement reviewed pagination before publishing release 65; older eligible releases cannot be evicted',
  );
  const bytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, releases: entries.map((item) => item.envelope) })}\n`,
  );
  requireValue(bytes.length <= CATALOG_LIMIT, 'catalog byte capacity');
  return bytes;
}
