import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANUAL_DOWNLOAD_LATEST_KEY,
  manualDownloadKey,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import { verifyCommercialCatalog } from '../public/desktop-commercial-catalog.mjs';
import { digest, verifyCommercialEnvelope } from './commercial-release-manifest.mjs';
import { MANUAL_CATALOG_KEY, verifyManualCatalog } from '../public/desktop-manual-catalog.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import { publishManualCommercialRelease } from './manual-commercial-publisher.mjs';
import { updateNotesStorageKey } from './manual-commercial-notes.mjs';
import { verifyUpdateNotes } from '../public/desktop-update-notes.mjs';
import * as stable from './commercial-release-test-support.mjs';
import * as preview from './preview-release-test-support.mjs';

function fixture(version = '1.2.3') {
  const identity = stable.fixture(version).identity;
  const installer = Buffer.from(`unsigned-package-${version}`);
  const objects = new Map();
  const writes = [];
  const verified = [];
  const store = {
    list: async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)),
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
    reviewedNotes: {
      schemaVersion: 1,
      sinceSourceSha: null,
      highlights: [`Improvements in ${version}.`],
    },
  };
}

test('manual release authenticates an installer and history without touching the automatic update feed', async () => {
  const f = fixture();
  const result = await publishManualCommercialRelease(f);
  assert.equal(result.status, 'published');
  assert.deepEqual(f.verified, ['local', 'remote']);
  assert.equal(f.writes.length, 5);
  assert.ok(f.writes.every(({ key }) => key.startsWith('desktop/commercial-manual/')));
  assert.equal(f.writes.at(-1).key, MANUAL_DOWNLOAD_LATEST_KEY);
  assert.equal(f.writes.at(-1).metadata.cacheControl, 'no-store');
  const latest = f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY).toString();
  const release = await verifyManualDownload(latest, stable.keySet);
  assert.equal(release.codeSigning, 'unsigned');
  assert.equal(release.updates, 'manual');
  assert.equal(release.artifacts.length, 1);
  const notes = await verifyUpdateNotes(
    f.objects.get(updateNotesStorageKey(release.version)).toString(),
    stable.keySet,
    release,
  );
  assert.deepEqual(notes.highlights, f.reviewedNotes.highlights);
  assert.equal(f.writes.at(-3).key, updateNotesStorageKey(release.version));
  assert.equal(f.writes.at(-3).metadata.cacheControl, 'public, max-age=31536000, immutable');
  assert.equal(f.writes.at(-2).key, MANUAL_CATALOG_KEY);
  assert.equal(f.writes.at(-2).metadata.cacheControl, 'no-store');
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
  assert.equal(f.writes.length, 5);
});

async function historyVersions(f) {
  return (
    await verifyManualCatalog(f.objects.get(MANUAL_CATALOG_KEY).toString(), stable.keySet)
  ).map((entry) => entry.release.version);
}

function nextRelease(f, version) {
  const next = fixture(version);
  return {
    ...next,
    store: f.store,
    expectedLatestSha256: digest(f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY)),
    reviewedNotes: { ...next.reviewedNotes, sinceSourceSha: 'a'.repeat(40) },
  };
}

test('the first history publication backfills immutable releases and retains every covered installer', async () => {
  const f = fixture('1.2.3');
  await publishManualCommercialRelease(f);
  await publishManualCommercialRelease(nextRelease(f, '1.9.0'));
  // Model an existing deployment whose old publisher never wrote this index.
  f.objects.delete(MANUAL_CATALOG_KEY);
  await publishManualCommercialRelease(nextRelease(f, '1.10.0'));
  assert.deepEqual(await historyVersions(f), ['1.10.0', '1.9.0', '1.2.3']);
  const archived = await verifyManualCatalog(
    f.objects.get(MANUAL_CATALOG_KEY).toString(),
    stable.keySet,
  );
  for (const { envelope, release } of archived) {
    assert.deepEqual(
      envelope,
      JSON.parse(f.objects.get(manualDownloadKey(release.version, 'download-manifest.json'))),
    );
    assert.equal(
      f.objects.has(manualDownloadKey(release.version, release.artifacts[0].name)),
      true,
    );
  }
  // Subsequent publication uses the verified index, not another bucket-wide scan.
  f.store.list = async () => {
    throw new Error('should not list again');
  };
  await publishManualCommercialRelease(nextRelease(f, '1.11.0'));
  assert.deepEqual(await historyVersions(f), ['1.11.0', '1.10.0', '1.9.0', '1.2.3']);
});

test('a legacy latest can gain history on an identical retry without rewriting installer objects', async () => {
  const f = fixture();
  await publishManualCommercialRelease(f);
  f.objects.delete(MANUAL_CATALOG_KEY);
  const count = f.writes.length;
  assert.equal((await publishManualCommercialRelease(f)).status, 'already-published');
  assert.deepEqual(
    f.writes.slice(count).map(({ key }) => key),
    [MANUAL_CATALOG_KEY],
  );
  assert.deepEqual(await historyVersions(f), ['1.2.3']);
});

test('interruption after history publication retries without losing history or advancing latest early', async () => {
  const f = fixture();
  await publishManualCommercialRelease(f);
  const oldLatest = f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY);
  const next = nextRelease(f, '1.2.4');
  const put = f.store.put;
  let interrupted = false;
  f.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key === MANUAL_CATALOG_KEY && !interrupted) {
      interrupted = true;
      throw new Error('Interrupted after history upload');
    }
  };
  await assert.rejects(publishManualCommercialRelease(next), /Interrupted/u);
  assert.deepEqual(f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY), oldLatest);
  assert.deepEqual(await historyVersions(f), ['1.2.4', '1.2.3']);
  assert.equal((await publishManualCommercialRelease(next)).status, 'published');
  assert.deepEqual(await historyVersions(f), ['1.2.4', '1.2.3']);
  assert.equal(f.writes.filter(({ key }) => key === MANUAL_CATALOG_KEY).length, 2);
});

for (const hasLatest of [false, true]) {
  test(`a later publication excludes an abandoned history entry (previous latest: ${hasLatest})`, async () => {
    const f = fixture('1.2.3');
    if (hasLatest) await publishManualCommercialRelease(f);
    const initialLatest = f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY) ?? null;
    const abandoned = hasLatest ? nextRelease(f, '1.2.4') : { ...fixture('1.2.4'), store: f.store };
    const put = f.store.put;
    f.store.put = async (key, bytes, metadata) => {
      await put(key, bytes, metadata);
      if (key === MANUAL_CATALOG_KEY) throw new Error('Interrupted after history upload');
    };
    await assert.rejects(publishManualCommercialRelease(abandoned), /Interrupted/u);
    assert.deepEqual(f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY) ?? null, initialLatest);
    assert.deepEqual(await historyVersions(f), hasLatest ? ['1.2.4', '1.2.3'] : ['1.2.4']);
    f.store.put = put;
    const next = hasLatest ? nextRelease(f, '1.2.5') : { ...fixture('1.2.5'), store: f.store };
    assert.equal((await publishManualCommercialRelease(next)).status, 'published');
    assert.deepEqual(await historyVersions(f), hasLatest ? ['1.2.5', '1.2.3'] : ['1.2.5']);
    // Unpromoted immutable evidence remains intact, but is not advertised as history.
    assert.ok(f.objects.has(manualDownloadKey('1.2.4', 'download-manifest.json')));
    assert.equal((await publishManualCommercialRelease(next)).status, 'already-published');
  });
}

test('corrupt history and missing historical installers refuse publication before any writes', async () => {
  for (const corrupt of [
    (f) => f.objects.set(MANUAL_CATALOG_KEY, Buffer.from('{}')),
    (f) => {
      f.objects.delete(MANUAL_CATALOG_KEY);
      f.objects.delete(manualDownloadKey('1.2.3', 'KerfDesk-1.2.3-windows-x64-setup.exe'));
    },
    (f) => {
      f.objects.delete(MANUAL_CATALOG_KEY);
      f.objects.set(
        manualDownloadKey('1.1.0', 'download-manifest.json'),
        f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY),
      );
    },
  ]) {
    const f = fixture();
    await publishManualCommercialRelease(f);
    const next = nextRelease(f, '1.2.4');
    corrupt(f);
    const count = f.writes.length;
    await assert.rejects(publishManualCommercialRelease(next));
    assert.equal(f.writes.length, count);
  }
});

test('concurrent history mutation and corrupt history readback never advance latest', async () => {
  for (const stage of ['immutable', 'history']) {
    const f = fixture();
    await publishManualCommercialRelease(f);
    const next = nextRelease(f, '1.2.4');
    const oldLatest = f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY);
    const put = f.store.put;
    f.store.put = async (key, bytes, metadata) => {
      await put(key, bytes, metadata);
      if (key === (stage === 'immutable' ? updateNotesStorageKey('1.2.4') : MANUAL_CATALOG_KEY))
        f.objects.set(MANUAL_CATALOG_KEY, Buffer.from('concurrent/corrupt'));
    };
    await assert.rejects(publishManualCommercialRelease(next), /history (?:changed|readback)/u);
    assert.deepEqual(f.objects.get(MANUAL_DOWNLOAD_LATEST_KEY), oldLatest);
  }
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
    { reviewedNotes: undefined },
    { reviewedNotes: { schemaVersion: 1, sinceSourceSha: null, highlights: [] } },
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
    assert.equal(f.writes.length, 5);
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

test('notes conflicts and corrupt notes readback refuse latest promotion', async () => {
  const conflict = fixture();
  conflict.objects.set(updateNotesStorageKey('1.2.3'), Buffer.from('different notes'));
  await assert.rejects(publishManualCommercialRelease(conflict), /Immutable/u);
  assert.equal(conflict.writes.length, 0);
  const corrupt = fixture();
  const get = corrupt.store.get;
  corrupt.store.get = async (key) =>
    key.endsWith('/release-notes.json') && corrupt.objects.has(key)
      ? Buffer.from('corrupt')
      : get(key);
  await assert.rejects(publishManualCommercialRelease(corrupt), /readback/u);
  assert.equal(corrupt.objects.has(MANUAL_DOWNLOAD_LATEST_KEY), false);
});

test('interrupted sidecar publication retries identical bytes before latest advances', async () => {
  const f = fixture();
  const put = f.store.put;
  let interrupted = false;
  f.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key.endsWith('/release-notes.json') && !interrupted) {
      interrupted = true;
      throw new Error('Interrupted after immutable notes upload.');
    }
  };
  await assert.rejects(publishManualCommercialRelease(f), /Interrupted/u);
  assert.equal(f.objects.has(MANUAL_DOWNLOAD_LATEST_KEY), false);
  assert.equal((await publishManualCommercialRelease(f)).status, 'published');
  assert.equal(f.writes.length, 5);
  assert.equal((await publishManualCommercialRelease(f)).status, 'already-published');
  assert.equal(f.writes.length, 5);
  await assert.rejects(
    publishManualCommercialRelease({
      ...f,
      reviewedNotes: { ...f.reviewedNotes, highlights: ['Changed after publication.'] },
    }),
    /Immutable/u,
  );
});

test('fresh notes must use authenticated previous source and concurrent latest changes are refused', async () => {
  const f = fixture();
  const previous = await publishManualCommercialRelease(f);
  const next = fixture('1.2.4');
  const input = { ...next, store: f.store, expectedLatestSha256: previous.latestSha256 };
  await assert.rejects(publishManualCommercialRelease(input), /previous release source/u);
  assert.equal(f.writes.length, 5);
  input.reviewedNotes = { ...next.reviewedNotes, sinceSourceSha: 'a'.repeat(40) };
  const put = f.store.put;
  f.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key === updateNotesStorageKey('1.2.4'))
      f.objects.set(MANUAL_DOWNLOAD_LATEST_KEY, Buffer.from('concurrent change'));
  };
  await assert.rejects(publishManualCommercialRelease(input), /changed during/u);
  assert.equal(f.writes.filter(({ key }) => key === MANUAL_DOWNLOAD_LATEST_KEY).length, 1);
});
