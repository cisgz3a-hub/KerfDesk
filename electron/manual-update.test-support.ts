// Signed manual-update fixtures shared by the manual-update suites.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export const key = generateKeyPairSync('ed25519');
export const keys = {
  test: key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
};
export const bytes = Buffer.from('verified fixture installer bytes');
export const now = Date.parse('2026-10-01T00:00:00.000Z');
export function envelope(payload: unknown): string {
  const data = Buffer.from(JSON.stringify(payload));
  return JSON.stringify({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: 'test',
    payload: data.toString('base64'),
    signature: sign(null, data, key.privateKey).toString('base64'),
  });
}
export function release(version = '1.0.1') {
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'manual-download',
    channel: 'stable',
    version,
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/main',
    publishedAt: '2026-09-30T23:00:00.000Z',
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts: [
      {
        name: `KerfDesk-${version}-windows-x64-setup.exe`,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
}
