import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANUAL_DOWNLOAD_LATEST_KEY,
  manualDownloadKey,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import { verifyCommercialCatalog } from '../public/desktop-commercial-catalog.mjs';
import { verifyCommercialEnvelope } from './commercial-release-manifest.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import { publishManualCommercialRelease } from './manual-commercial-publisher.mjs';
import * as stable from './commercial-release-test-support.mjs';
import * as preview from './preview-release-test-support.mjs';

function fixture(version = '1.2.3') {
  const identity = stable.fixture(version).identity;
  const installer = Buffer.from(`unsigned-package-${version}`);
  const objects = new Map();
  const writes = [];
  const verified = [];
  const store = {
    get: async (key) => objects.get(key) ?? null,
    put: async (key, bytes, metadata) => {
      writes.push({ key, metadata });
      objects.set(key, Buffer.from(bytes));
    },
  };
  return {
    identity,
    installer,
    objects,
    writes,
    verified,
    store,
    keySet: stable.keySet,
    keyId: stable.keyId,
    privateKeyPem: stable.privateKeyPem,
    verifyInstaller: async (bytes, stage) => {
      assert.deepEqual(bytes, installer);
      verified.push(stage);
    },
    expectedLatestSha256: 'none',
  };
}

test('manual release authenticates one installer, reads it back, and never touches update catalogues', async () => {
  const f = fixture();
  const result = await publishManualCommercialRelease(f);
  assert.equal(result.status, 'published');
  assert.deepEqual(f.verified, ['local', 'remote']);
  assert.equal(f.writes.length, 3);
  assert.ok(f.writes.every(({ key }) => key.startsWith('desktop/commercial-manual/')));
  assert.equal(f.writes.at(-1).key, MANUAL_DOWNLOAD_LATEST_KEY);
  assert.equal(f.writes.at(-1).metadata.cacheControl, 'no-store');
  const latest = f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY).toString();
  const release = await verifyManualDownload(latest, stable.keySet);
  assert.equal(release.codeSigning, 'unsigned');
  assert.equal(release.updates, 'manual');
  assert.equal(release.artifacts.length, 1);
  assert.equal(
    f.objects.get(manualDownloadKey(release.version, 'download-manifest.json')).toString(),
    latest,
  );
  // These are deliberately a different schema, even with the genuine stable-key signature.
  assert.throws(() => verifyCommercialEnvelope(JSON.parse(latest), stable.keySet));
  await assert.rejects(
    verifyCommercialCatalog(
      JSON.stringify({ schemaVersion: 1, releases: [JSON.parse(latest)] }),
      stable.keySet,
    ),
  );
  assert.equal((await publishManualCommercialRelease(f)).status, 'already-published');
  assert.equal(f.writes.length, 3);
});

test('invalid package, missing verifier, wrong key and stale reviewed state stop before writes', async () => {
  for (const patch of [
    { verifyInstaller: undefined },
    {
      verifyInstaller: async () => {
        throw new Error('package mismatch');
      },
    },
    { privateKeyPem: preview.privateKeyPem },
    { expectedLatestSha256: 'f'.repeat(64) },
  ]) {
    const f = fixture();
    await assert.rejects(publishManualCommercialRelease({ ...f, ...patch }));
    assert.equal(f.writes.length, 0);
  }
});

test('immutable conflicts are refused before any storage mutation', async () => {
  const f = fixture();
  f.objects.set(
    manualDownloadKey('1.2.3', 'download-manifest.json'),
    Buffer.from('different build'),
  );
  await assert.rejects(publishManualCommercialRelease(f), /Immutable/u);
  assert.equal(f.writes.length, 0);
});

test('corrupt artifact readback never advances latest', async () => {
  const f = fixture();
  const get = f.store.get;
  f.store.get = async (key) =>
    key.endsWith('.exe') && f.objects.has(key) ? Buffer.from('corrupt') : get(key);
  await assert.rejects(publishManualCommercialRelease(f), /readback/u);
  assert.equal(f.objects.has(MANUAL_DOWNLOAD_LATEST_KEY), false);
});

test('manual history cannot roll back or replace the bytes of an already-published version', async () => {
  const f = fixture('1.3.0');
  const first = await publishManualCommercialRelease(f);
  const older = fixture('1.2.3');
  const changed = fixture('1.3.0');
  changed.installer = Buffer.from('changed executable');
  changed.verifyInstaller = async () => undefined;
  for (const next of [older, changed]) {
    await assert.rejects(
      publishManualCommercialRelease({
        ...next,
        store: f.store,
        expectedLatestSha256: first.latestSha256,
      }),
    );
    assert.equal(f.writes.length, 3);
  }
});

test('publisher and browser refuse untrusted signatures, paths, channels and automatic update claims', async () => {
  const f = fixture();
  const payload = manualDownloadPayload(f.identity, f.installer, stable.keySet);
  const good = await signManualDownload(payload, stable.privateKeyPem, stable.keyId, stable.keySet);
  for (const change of [
    { updates: 'automatic' },
    { codeSigning: 'signed' },
    { channel: 'preview' },
    { url: 'https://attacker.invalid/evil.exe' },
    { sourceRef: 'refs/heads/feature' },
    { artifacts: [{ ...payload.artifacts[0], name: '../../evil.exe' }] },
  ])
    await assert.rejects(
      verifyManualDownload(JSON.stringify(stable.signed({ ...payload, ...change })), stable.keySet),
    );
  await assert.rejects(
    verifyManualDownload(
      JSON.stringify({ ...good, signature: Buffer.alloc(64).toString('base64') }),
      stable.keySet,
    ),
  );
  await assert.rejects(verifyManualDownload(JSON.stringify(good), preview.keySet));
});
