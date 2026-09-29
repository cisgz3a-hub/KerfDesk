import assert from 'node:assert/strict';
import test from 'node:test';
import { promoteCommercialRelease } from './commercial-release-rings.mjs';
import {
  commercialReleaseFiles,
  publishCommercialRelease,
} from './commercial-release-publisher.mjs';
import {
  COMMERCIAL_BETA_CATALOG_KEY,
  COMMERCIAL_CATALOG_KEY,
  catalogBytes,
  readCommercialCatalog,
  signCommercialManifest,
  updatePayload,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import {
  fixture,
  keyId,
  keySet,
  memoryStore,
  privateKeyPem,
} from './commercial-release-test-support.mjs';

const publish = (release, store) =>
  publishCommercialRelease({
    release,
    store,
    keySet,
    privateKeyPem,
    keyId,
    verifyInstaller: async () => undefined,
  });
const promote = (store, version = '1.2.3') => promoteCommercialRelease({ store, keySet, version });
const RELEASES = 'desktop/commercial/releases';

async function beta(...releases) {
  const f = memoryStore();
  for (const release of releases) await publish(release, f.store);
  f.writes.length = 0;
  return f;
}
// The catalogue another publication would have written, for seeding a ring.
async function catalogueOf(...releases) {
  return (await beta(...releases)).objects.get(COMMERCIAL_BETA_CATALOG_KEY);
}
const stableWrites = (f) => f.writes.filter((write) => write.key === COMMERCIAL_CATALOG_KEY);

test('promotion copies the identical signed beta entry to stable, keeping older stable releases', async () => {
  const f = await beta(fixture('1.0.0'));
  assert.equal((await promote(f.store, '1.0.0')).status, 'promoted');
  await publish(fixture('1.2.3', { sourceRef: 'refs/heads/main' }), f.store);
  const manifest = f.objects.get(`${RELEASES}/1.2.3/update-manifest.json`);
  f.writes.length = 0;
  assert.deepEqual(await promote(f.store), { status: 'promoted', version: '1.2.3' });
  const betaEntries = readCommercialCatalog(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY), keySet);
  const stable = readCommercialCatalog(f.objects.get(COMMERCIAL_CATALOG_KEY), keySet);
  assert.deepEqual(
    stable.map((entry) => entry.payload.version),
    ['1.2.3', '1.0.0'],
  );
  // Same bytes, no second signature: stable now reads exactly as beta does.
  assert.deepEqual(stable[0].envelope, betaEntries[0].envelope);
  assert.deepEqual(
    f.objects.get(COMMERCIAL_CATALOG_KEY),
    f.objects.get(COMMERCIAL_BETA_CATALOG_KEY),
  );
  assert.deepEqual(f.objects.get(`${RELEASES}/1.2.3/update-manifest.json`), manifest);
  assert.deepEqual(
    f.writes.map((write) => [write.key, write.metadata.cacheControl]),
    [[COMMERCIAL_CATALOG_KEY, 'no-store']],
  );
  // A repeated promotion changes nothing.
  f.writes.length = 0;
  assert.equal((await promote(f.store)).status, 'already-promoted');
  assert.equal(f.writes.length, 0);
});

test('only a release the beta ring lists can reach stable, and only as that one envelope', async () => {
  const f = await beta(fixture('1.0.0'));
  await assert.rejects(promote(f.store), /1\.2\.3 is not in the beta catalogue/u);
  await assert.rejects(promote(f.store, '1.2'), /strict stable version/u);
  const g = await beta(fixture());
  g.objects.set(
    COMMERCIAL_CATALOG_KEY,
    await catalogueOf(fixture('1.2.3', { publishedAt: '2026-01-02T00:00:00.000Z' })),
  );
  await assert.rejects(promote(g.store), /stable catalogue lists a different 1\.2\.3/u);
  assert.equal(f.writes.length + g.writes.length, 0);
});

test('promotion never rolls stable back or backdates it', async () => {
  const f = await beta(fixture('1.1.0'));
  f.objects.set(COMMERCIAL_CATALOG_KEY, await catalogueOf(fixture('1.2.3')));
  await assert.rejects(promote(f.store, '1.1.0'), /stable rollback/u);
  const g = await beta(fixture());
  g.objects.set(
    COMMERCIAL_CATALOG_KEY,
    await catalogueOf(fixture('1.0.0', { publishedAt: '2026-01-02T00:00:00.000Z' })),
  );
  await assert.rejects(promote(g.store), /date cannot precede/u);
  assert.equal(stableWrites(f).length + stableWrites(g).length, 0);
});

test('changed or missing release objects are never offered to everyone', async () => {
  const cases = [
    [`${RELEASES}/1.2.3/update-manifest.json`, Buffer.from('{}\n'), /update manifest/u],
    [`${RELEASES}/1.2.3/KerfDesk-1.2.3-windows-x64-setup.exe`, Buffer.from('wrong'), /setup\.exe/u],
    [`${RELEASES}/1.2.3/latest.yml`, null, /latest\.yml does not match/u],
  ];
  for (const [key, bytes, error] of cases) {
    const f = await beta(fixture());
    if (bytes === null) f.objects.delete(key);
    else f.objects.set(key, bytes);
    await assert.rejects(promote(f.store), error);
    assert.equal(f.objects.has(COMMERCIAL_CATALOG_KEY), false);
    assert.equal(f.writes.length, 0);
  }
});

test('a stable catalogue that moves during promotion, or reads back wrong, fails the promotion', async () => {
  const f = await beta(fixture());
  const get = f.store.get;
  f.store.get = async (key) => {
    if (key.endsWith('.blockmap'))
      f.objects.set(COMMERCIAL_CATALOG_KEY, await catalogueOf(fixture('1.0.0')));
    return get(key);
  };
  await assert.rejects(promote(f.store), /changed during promotion/u);
  assert.equal(stableWrites(f).length, 0);
  const g = await beta(fixture());
  const put = g.store.put;
  g.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key === COMMERCIAL_CATALOG_KEY) g.objects.set(key, Buffer.from('truncated'));
  };
  await assert.rejects(promote(g.store), /readback failed/u);
});

test('a full stable catalogue refuses promotion before any write instead of dropping history', async () => {
  const entries = Array.from({ length: 65 }, (_, index) => {
    const release = fixture(`1.0.${index}`);
    const identity = verifyCommercialEnvelope(release.identity, keySet, 'release-identity');
    const payload = updatePayload(identity, commercialReleaseFiles(release, identity));
    return { payload, envelope: signCommercialManifest(payload, privateKeyPem, keyId, keySet) };
  });
  const f = memoryStore();
  f.objects.set(COMMERCIAL_CATALOG_KEY, catalogBytes(entries.slice(0, 64)));
  f.objects.set(COMMERCIAL_BETA_CATALOG_KEY, catalogBytes(entries.slice(64)));
  await assert.rejects(promote(f.store, '1.0.64'), /capacity/u);
  assert.equal(f.writes.length, 0);
});
