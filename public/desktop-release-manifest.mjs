/* global atob, btoa, TextEncoder, TextDecoder, crypto */
// One bounded verification contract for the desktop, download page and publisher.
// Keys are packaged/website-owned; never learned from the download server.
export const PREVIEW_ORIGIN = 'https://dl.kerfdesk.com';
export const PREVIEW_PREFIX = 'desktop/previews';
export const PREVIEW_MANIFEST_LIMIT = 128 * 1024;
const VERSION =
  /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})-preview\.(0|[1-9]\d{0,15})$/u;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid signed release metadata: ${message}`);
}
function exactKeys(value, keys) {
  return record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
export function isPreviewVersion(value) {
  return typeof value === 'string' && VERSION.test(value);
}
export function comparePreviewVersions(left, right) {
  requireValue(isPreviewVersion(left) && isPreviewVersion(right), 'version');
  const a = VERSION.exec(left).slice(1).map(BigInt);
  const b = VERSION.exec(right).slice(1).map(BigInt);
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
export function previewArtifactNames(version) {
  requireValue(isPreviewVersion(version), 'version');
  return [
    `KerfDesk-${version}-windows-x64-setup.exe`,
    `KerfDesk-${version}-macos-x64.dmg`,
    `KerfDesk-${version}-macos-arm64.dmg`,
    `KerfDesk-${version}-SHA256SUMS.txt`,
    `KerfDesk-${version}-release-manifest.json`,
    `KerfDesk-${version}-sbom.cdx.json`,
    `KerfDesk-${version}-release-notes.md`,
  ];
}
export function previewAssetUrl(version, name) {
  requireValue(previewArtifactNames(version).includes(name), 'artifact name');
  return `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/${version}/${name}`;
}
export function validatePreviewPayload(value, now = Date.now()) {
  requireValue(
    exactKeys(value, [
      'schemaVersion',
      'channel',
      'version',
      'sourceSha',
      'sourceRef',
      'publishedAt',
      'provenance',
      'artifacts',
    ]),
    'payload fields',
  );
  requireValue(value.schemaVersion === 1 && value.channel === 'preview', 'channel/schema');
  requireValue(isPreviewVersion(value.version), 'version');
  requireValue(
    /^[a-f0-9]{40}$/u.test(value.sourceSha) && value.sourceRef === `refs/tags/v${value.version}`,
    'source',
  );
  requireValue(
    typeof value.publishedAt === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value.publishedAt),
    'publication time',
  );
  const time = Date.parse(value.publishedAt);
  requireValue(
    Number.isFinite(time) &&
      new Date(time).toISOString() === value.publishedAt &&
      time <= now + 300_000,
    'publication time',
  );
  const proof = value.provenance;
  requireValue(
    exactKeys(proof, ['kind', 'repository', 'workflow', 'runId', 'runAttempt']),
    'provenance fields',
  );
  requireValue(
    ['github-attestation', 'publisher-signature'].includes(proof.kind) &&
      proof.repository === 'cisgz3a-hub/KerfDesk' &&
      proof.workflow === '.github/workflows/release-desktop-preview.yml',
    'provenance',
  );
  requireValue(
    typeof proof.runId === 'string' &&
      /^[1-9]\d{0,19}$/u.test(proof.runId) &&
      typeof proof.runAttempt === 'string' &&
      /^[1-9]\d{0,5}$/u.test(proof.runAttempt),
    'run identity',
  );
  const expected = previewArtifactNames(value.version);
  requireValue(
    Array.isArray(value.artifacts) && value.artifacts.length === expected.length,
    'artifact count',
  );
  const seen = new Set();
  for (const artifact of value.artifacts) {
    requireValue(exactKeys(artifact, ['name', 'bytes', 'sha256']), 'artifact fields');
    requireValue(
      expected.includes(artifact.name) && !seen.has(artifact.name),
      'artifact name or duplicate',
    );
    seen.add(artifact.name);
    requireValue(
      Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 300_000_000,
      'artifact size',
    );
    requireValue(
      typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(artifact.sha256),
      'artifact digest',
    );
  }
  return value;
}
function decodeBase64(value, maxBytes) {
  requireValue(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= Math.ceil(maxBytes / 3) * 4 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value),
    'base64',
  );
  const decoded = atob(value);
  requireValue(decoded.length <= maxBytes && btoa(decoded) === value, 'canonical base64');
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
export async function verifyPreviewManifest(text, keySet, now = Date.now()) {
  requireValue(
    typeof text === 'string' && new TextEncoder().encode(text).length <= PREVIEW_MANIFEST_LIMIT,
    'size',
  );
  return validatePreviewPayload(
    await verifySignedEnvelope(JSON.parse(text), keySet, 'preview'),
    now,
  );
}
// A website/package anchor authorizes a key for exactly one release channel, so a
// Preview key can never sign a commercial release and a stable key never a Preview.
export async function verifySignedEnvelope(envelope, keySet, channel) {
  requireValue(
    exactKeys(envelope, ['schemaVersion', 'keyId', 'algorithm', 'payload', 'signature']) &&
      envelope.schemaVersion === 1 &&
      envelope.algorithm === 'Ed25519',
    'envelope',
  );
  requireValue(
    typeof envelope.keyId === 'string' && /^[a-z0-9-]{1,64}$/u.test(envelope.keyId),
    'key ID',
  );
  requireValue(
    record(keySet) &&
      keySet.schemaVersion === 1 &&
      Array.isArray(keySet.keys) &&
      keySet.keys.length <= 16,
    'trust anchors',
  );
  const matches = keySet.keys.filter((key) => record(key) && key.keyId === envelope.keyId);
  requireValue(
    matches.length === 1 && matches[0].algorithm === 'Ed25519' && matches[0].channel === channel,
    'unknown or wrong-purpose signing key',
  );
  const key = await crypto.subtle.importKey(
    'spki',
    decodeBase64(matches[0].publicKeySpki, 256),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const payload = decodeBase64(envelope.payload, 64 * 1024);
  const signature = decodeBase64(envelope.signature, 64);
  requireValue(
    signature.length === 64 && (await crypto.subtle.verify('Ed25519', key, signature, payload)),
    'signature',
  );
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
}
export async function readBoundedManifest(response, limit = PREVIEW_MANIFEST_LIMIT) {
  requireValue(response.status === 200 && response.body !== null, 'HTTP response');
  const length = response.headers.get('content-length');
  requireValue(length === null || (/^\d+$/u.test(length) && Number(length) <= limit), 'HTTP size');
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      requireValue(received <= limit, 'HTTP size');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
