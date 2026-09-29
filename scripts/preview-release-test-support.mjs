import { generateKeyPairSync, sign } from 'node:crypto';
import { previewArtifactNames } from '../public/desktop-release-manifest.mjs';
import { sha256 } from './preview-release-publisher.mjs';

const key = generateKeyPairSync('ed25519');
export const keyId = 'preview-test';
export const privateKeyPem = key.privateKey.export({ format: 'pem', type: 'pkcs8' });
export const keySet = {
  schemaVersion: 1,
  keys: [
    {
      keyId,
      algorithm: 'Ed25519',
      channel: 'preview',
      publicKeySpki: key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    },
  ],
};
export function fixture(version = '0.2.0-preview.14') {
  const files = previewArtifactNames(version).map((name) => ({
    name,
    bytes: Buffer.from(`fixture ${name}`),
  }));
  const metadata = {
    schemaVersion: 1,
    channel: 'preview',
    version,
    sourceSha: 'a'.repeat(40),
    sourceRef: `refs/tags/v${version}`,
    publishedAt: '2026-01-01T00:00:00.000Z',
    provenance: {
      kind: 'publisher-signature',
      repository: 'cisgz3a-hub/KerfDesk',
      workflow: '.github/workflows/release-desktop-preview.yml',
      runId: '123',
      runAttempt: '1',
    },
  };
  return {
    metadata,
    files,
    payload: {
      ...metadata,
      artifacts: files.map(({ name, bytes }) => ({
        name,
        bytes: bytes.length,
        sha256: sha256(bytes),
      })),
    },
  };
}
export function rawEnvelope(payload = fixture().payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return JSON.stringify({
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, key.privateKey).toString('base64'),
  });
}
export function memoryStore() {
  const objects = new Map();
  const writes = [];
  return {
    objects,
    writes,
    store: {
      async get(key) {
        return objects.has(key) ? Buffer.from(objects.get(key)) : null;
      },
      async put(key, bytes, metadata) {
        writes.push({ key, bytes, metadata });
        objects.set(key, Buffer.from(bytes));
      },
    },
  };
}
