import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishCommercialRelease,
  commercialReleaseFiles,
} from './commercial-release-publisher.mjs';
import {
  COMMERCIAL_CATALOG_KEY,
  readCommercialCatalog,
  catalogBytes,
  signCommercialManifest,
  updatePayload,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import {
  fixture,
  memoryStore,
  keySet,
  privateKeyPem,
  keyId,
  signed,
} from './commercial-release-test-support.mjs';
const publish = (release, store, verifyInstaller = async () => undefined) =>
  publishCommercialRelease({ release, store, keySet, privateKeyPem, keyId, verifyInstaller });

test('publishes complete immutable assets and verified update manifest before the catalogue', async () => {
  const f = memoryStore();
  const verified = [];
  f.objects.set('desktop/latest.yml', Buffer.from('legacy'));
  f.objects.set('desktop/previews/latest.json', Buffer.from('preview'));
  await publish(fixture(), f.store, async (_bytes, source) => verified.push(source));
  assert.deepEqual(verified, ['local', 'remote']);
  assert.equal(f.writes[0].key, 'desktop/commercial/releases/1.2.3/publication-reservation.json');
  assert.equal(f.writes.at(-2).key, 'desktop/commercial/releases/1.2.3/update-manifest.json');
  assert.equal(f.writes.at(-1).key, COMMERCIAL_CATALOG_KEY);
  assert.equal(f.writes.at(-1).metadata.cacheControl, 'no-store');
  assert.ok(f.writes.every((write) => write.key.startsWith('desktop/commercial/')));
  assert.equal(f.objects.get('desktop/latest.yml').toString(), 'legacy');
  assert.equal(f.objects.get('desktop/previews/latest.json').toString(), 'preview');
  const entry = readCommercialCatalog(f.objects.get(COMMERCIAL_CATALOG_KEY), keySet)[0];
  assert.equal(entry.payload.publishedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(entry.payload.artifacts.length, 3);
});
test('keeps every older eligible release and refuses rollback or immutable conflicts', async () => {
  const f = memoryStore();
  await publish(fixture('1.0.0'), f.store);
  await publish(fixture(), f.store);
  assert.deepEqual(
    readCommercialCatalog(f.objects.get(COMMERCIAL_CATALOG_KEY), keySet).map(
      (item) => item.payload.version,
    ),
    ['1.2.3', '1.0.0'],
  );
  f.writes.length = 0;
  await assert.rejects(publish(fixture('1.1.0'), f.store), /rollback/u);
  const rebuilt = fixture();
  rebuilt.files[1].bytes = Buffer.from('changed blockmap');
  await assert.rejects(publish(rebuilt, f.store), /conflicts/u);
  assert.equal(f.writes.length, 0);
});
test('exact-byte retry is a no-op but still verifies local and remote installer signatures', async () => {
  const f = memoryStore();
  await publish(fixture(), f.store);
  f.writes.length = 0;
  const calls = [];
  assert.equal(
    (await publish(fixture(), f.store, async (_bytes, source) => calls.push(source))).status,
    'already-published',
  );
  assert.equal(f.writes.length, 0);
  assert.deepEqual(calls, ['local', 'remote']);
});
test('interrupted publication resumes matching reserved bytes without promoting incomplete assets', async () => {
  const f = memoryStore();
  const put = f.store.put;
  let fail = true;
  f.store.put = async (key, bytes, metadata) => {
    if (fail && key.endsWith('.blockmap')) throw new Error('interrupted');
    await put(key, bytes, metadata);
  };
  await assert.rejects(publish(fixture(), f.store), /interrupted/u);
  assert.equal(f.objects.has(COMMERCIAL_CATALOG_KEY), false);
  assert.equal(f.objects.has('desktop/commercial/releases/1.2.3/update-manifest.json'), false);
  const reserved = f.objects.get('desktop/commercial/releases/1.2.3/publication-reservation.json');
  fail = false;
  assert.equal((await publish(fixture(), f.store)).status, 'published');
  assert.deepEqual(
    f.objects.get('desktop/commercial/releases/1.2.3/publication-reservation.json'),
    reserved,
  );
});
test('all immutable conflicts, invalid catalogs and signature failures fail closed', async () => {
  const f = memoryStore();
  f.objects.set('desktop/commercial/releases/1.2.3/latest.yml', Buffer.from('conflict'));
  await assert.rejects(publish(fixture(), f.store), /conflict/u);
  assert.equal(f.writes.length, 0);
  f.objects.clear();
  f.objects.set(COMMERCIAL_CATALOG_KEY, Buffer.from('{}'));
  await assert.rejects(publish(fixture(), f.store));
  assert.equal(f.writes.length, 0);
  f.objects.clear();
  await assert.rejects(
    publish(fixture(), f.store, async () => {
      throw new Error('invalid signer');
    }),
    /invalid signer/u,
  );
  assert.equal(f.writes.length, 0);
  await assert.rejects(
    publishCommercialRelease({ release: fixture(), store: f.store, keySet, keyId, privateKeyPem }),
    /mandatory/u,
  );
});
test('remote corruption, remote signer rejection and moving catalog never promote', async () => {
  for (const mode of ['corrupt', 'signer', 'race']) {
    const f = memoryStore();
    const put = f.store.put;
    f.store.put = async (key, bytes, metadata) => {
      await put(key, bytes, metadata);
      if (key.endsWith('-setup.exe') && mode === 'corrupt')
        f.objects.set(key, Buffer.from('wrong'));
      if (key.endsWith('.blockmap') && mode === 'race')
        f.objects.set(COMMERCIAL_CATALOG_KEY, Buffer.from('changed'));
    };
    await assert.rejects(
      publish(fixture(), f.store, async (_bytes, source) => {
        if (mode === 'signer' && source === 'remote') throw new Error('remote signer');
      }),
    );
    assert.equal(
      f.writes.some((item) => item.key === COMMERCIAL_CATALOG_KEY),
      false,
    );
  }
});

test('catalogue promotion is not reported successful without exact readback', async () => {
  const f = memoryStore();
  const put = f.store.put;
  f.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key === COMMERCIAL_CATALOG_KEY) f.objects.set(key, Buffer.from('truncated'));
  };
  await assert.rejects(publish(fixture(), f.store), /catalogue readback/u);
  assert.ok(f.objects.has('desktop/commercial/releases/1.2.3/update-manifest.json'));
});
test('a full bounded catalog fails publication before writes instead of dropping purchased eligibility history', async () => {
  const entries = Array.from({ length: 64 }, (_, index) => {
    const release = fixture(`1.0.${index}`);
    const identity = verifyCommercialEnvelope(release.identity, keySet, 'release-identity');
    const payload = updatePayload(identity, commercialReleaseFiles(release, identity));
    return { payload, envelope: signCommercialManifest(payload, privateKeyPem, keyId, keySet) };
  });
  const f = memoryStore();
  f.objects.set(COMMERCIAL_CATALOG_KEY, catalogBytes(entries));
  await assert.rejects(publish(fixture('1.0.64'), f.store), /capacity/u);
  assert.equal(f.writes.length, 0);
});
test('signed identity cannot be replaced or backdated and malformed artifacts never reach storage', async () => {
  const f = memoryStore();
  await publish(fixture(), f.store);
  f.writes.length = 0;
  const older = fixture('1.2.4');
  const payload = JSON.parse(Buffer.from(older.identity.payload, 'base64').toString());
  payload.publishedAt = '2025-01-01T00:00:00.000Z';
  older.identity = signed(payload);
  await assert.rejects(publish(older, f.store), /date/u);
  const duplicate = fixture('1.2.4');
  duplicate.files[1] = duplicate.files[0];
  await assert.rejects(publish(duplicate, f.store), /three/u);
  const traversal = fixture('1.2.4');
  traversal.files[0].name = '../evil.exe';
  await assert.rejects(publish(traversal, f.store), /artifact/u);
  assert.equal(f.writes.length, 0);
});
