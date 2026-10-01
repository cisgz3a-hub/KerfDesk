import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { keySet, signed } from './commercial-release-test-support.mjs';
import {
  authenticatePublishedInstaller,
  boundedPublishedBytes,
} from './published-upgrade-installers.mjs';

const bytes = Buffer.from('approved immutable unsigned installer fixture');
const payload = {
  schemaVersion: 1,
  product: 'kerfdesk-desktop',
  kind: 'manual-download',
  channel: 'stable',
  version: '1.2.3',
  sourceSha: 'a'.repeat(40),
  sourceRef: 'refs/heads/main',
  publishedAt: '2026-01-01T00:00:00.000Z',
  codeSigning: 'unsigned',
  updates: 'manual',
  artifacts: [
    {
      name: 'KerfDesk-1.2.3-windows-x64-setup.exe',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
};
const manifest = JSON.stringify(signed(payload));

test('historical installer requires the approved signature, requested version and exact bytes', async () => {
  assert.deepEqual(await authenticatePublishedInstaller(manifest, '1.2.3', keySet, bytes), payload);
  await assert.rejects(authenticatePublishedInstaller(manifest, '1.2.4', keySet, bytes), /version/);
  await assert.rejects(
    authenticatePublishedInstaller(manifest, '1.2.3', keySet, bytes.subarray(1)),
    /size or SHA/,
  );
  const sameSizeTamper = Buffer.from(bytes);
  sameSizeTamper[0] ^= 1;
  await assert.rejects(
    authenticatePublishedInstaller(manifest, '1.2.3', keySet, sameSizeTamper),
    /size or SHA/,
  );
  await assert.rejects(
    authenticatePublishedInstaller(manifest, '1.2.3', keySet, bytes.toString()),
    /byte data/,
  );
  const envelope = JSON.parse(manifest);
  envelope.signature = Buffer.alloc(64).toString('base64');
  await assert.rejects(
    authenticatePublishedInstaller(JSON.stringify(envelope), '1.2.3', keySet, bytes),
  );
});

test('a correctly signed payload still cannot supply a path or an automatic-update channel', async () => {
  for (const changed of [
    { ...payload, artifacts: [{ ...payload.artifacts[0], name: '../installer.exe' }] },
    { ...payload, codeSigning: 'signed', updates: 'automatic' },
  ]) {
    await assert.rejects(
      authenticatePublishedInstaller(JSON.stringify(signed(changed)), '1.2.3', keySet, bytes),
    );
  }
});

test('public downloads enforce actual and declared bounds, completeness and successful status', async () => {
  assert.equal(
    (await boundedPublishedBytes(new Response(bytes), bytes.length)).length,
    bytes.length,
  );
  await assert.rejects(boundedPublishedBytes(new Response(bytes), bytes.length - 1), /exceeds/);
  await assert.rejects(
    boundedPublishedBytes(new Response(bytes, { status: 404 }), 100),
    /fetch failed/,
  );
  await assert.rejects(boundedPublishedBytes(new Response(''), 100), /incomplete/);
  await assert.rejects(
    boundedPublishedBytes(new Response(bytes, { headers: { 'content-length': '9999' } }), 100),
    /declared/,
  );
  await assert.rejects(
    boundedPublishedBytes(new Response(bytes, { headers: { 'content-length': '1' } }), 100),
    /incomplete/,
  );
});
