import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  betaObservationKey,
  readBetaObservation,
  recordBetaObservation,
} from './commercial-beta-observation.mjs';
import {
  COMMERCIAL_BETA_CATALOG_KEY,
  digest,
  readCommercialCatalog,
} from './commercial-release-manifest.mjs';
import { publishCommercialRelease } from './commercial-release-publisher.mjs';
import {
  fixture,
  keyId,
  keySet,
  memoryStore,
  privateKeyPem,
  signed,
} from './commercial-release-test-support.mjs';

const PUBLICATION = new Date('2026-10-18T07:00:00.000Z');
const LATER = new Date('2026-10-20T07:00:00.000Z');
const VERSION = '2026.42.0';
const receiptKey = betaObservationKey(VERSION);

async function published() {
  const f = memoryStore();
  await publishCommercialRelease({
    release: fixture(VERSION, { publishedAt: '2026-10-13T07:17:00.000Z' }),
    store: f.store,
    keySet,
    privateKeyPem,
    keyId,
    verifyInstaller: async () => undefined,
    expectedCatalogSha256: 'none',
  });
  const options = {
    store: f.store,
    keySet,
    privateKeyPem,
    keyId,
    version: VERSION,
    expectedCatalogSha256: digest(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY)),
    clock: () => PUBLICATION,
    fetchImpl: async (url, init) => {
      assert.equal(url, `https://dl.kerfdesk.com/${COMMERCIAL_BETA_CATALOG_KEY}`);
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      return new Response(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY));
    },
  };
  const entry = readCommercialCatalog(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY), keySet)[0];
  return { ...f, options, entry };
}

test('public beta observation starts after a delayed build, and exact retries retain it', async () => {
  const f = await published();
  let seen = false;
  const fetchImpl = f.options.fetchImpl;
  const observed = await recordBetaObservation({
    ...f.options,
    fetchImpl: async (...args) => {
      const result = await fetchImpl(...args);
      seen = true;
      return result;
    },
    clock: () => {
      assert.equal(seen, true, 'the clock cannot start before public verification');
      return PUBLICATION;
    },
  });
  assert.equal(observed, PUBLICATION.toISOString());
  const bytes = f.objects.get(receiptKey);
  assert.equal(readBetaObservation(bytes, f.entry, keySet, LATER), observed);
  const writes = f.writes.length;
  assert.equal(await recordBetaObservation({ ...f.options, clock: () => LATER }), observed);
  assert.equal(f.writes.length, writes);
  assert.deepEqual(f.objects.get(receiptKey), bytes);
  assert.match(f.writes.at(-1).metadata.cacheControl, /immutable/u);
});

test('missing, unavailable, stale or oversized public catalogues never create an observation', async () => {
  for (const response of [
    () => new Response(null, { status: 404 }),
    () => new Response(null, { status: 503 }),
    () => new Response(JSON.stringify({ schemaVersion: 1, releases: [] })),
    () => new Response('x'.repeat(262_145)),
  ]) {
    const f = await published();
    await assert.rejects(
      recordBetaObservation({ ...f.options, fetchImpl: async () => response() }),
    );
    assert.equal(f.objects.has(receiptKey), false);
  }
});

test('receipt failures hold probation and recover conservatively after a successful retry', async () => {
  const f = await published();
  const put = f.store.put;
  f.store.put = async (key, bytes, metadata) => {
    if (key === receiptKey) throw new Error('interrupted receipt write');
    return put(key, bytes, metadata);
  };
  await assert.rejects(recordBetaObservation(f.options), /interrupted receipt write/u);
  assert.equal(readBetaObservation(null, f.entry, keySet, PUBLICATION), null);
  f.store.put = put;
  assert.equal(
    await recordBetaObservation({ ...f.options, clock: () => LATER }),
    LATER.toISOString(),
  );
  // A committed receipt with a lost readback is reused unchanged on retry.
  const second = await published();
  const get = second.store.get;
  second.store.get = async (key) => {
    if (key === receiptKey && second.objects.has(key)) throw new Error('lost receipt readback');
    return get(key);
  };
  await assert.rejects(recordBetaObservation(second.options), /lost receipt readback/u);
  const original = second.objects.get(receiptKey);
  second.store.get = get;
  assert.equal(
    await recordBetaObservation({ ...second.options, clock: () => LATER }),
    PUBLICATION.toISOString(),
  );
  assert.deepEqual(second.objects.get(receiptKey), original);
});

test('receipt is bound to the exact signed release and rejects tampering and invalid time', async () => {
  const f = await published();
  await recordBetaObservation(f.options);
  const original = f.objects.get(receiptKey);
  const envelope = JSON.parse(original);
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64'));
  const read = (bytes) => readBetaObservation(bytes, f.entry, keySet, LATER);
  for (const changed of [
    { ...payload, version: '2026.42.1' },
    { ...payload, sourceSha: 'b'.repeat(40) },
    { ...payload, manifestSha256: '0'.repeat(64) },
    { ...payload, observedAt: '2026-10-01T00:00:00.000Z' },
    { ...payload, observedAt: '2026-11-01T00:00:00.000Z' },
    { ...payload, observedAt: 'invalid' },
  ]) {
    assert.throws(() => read(Buffer.from(JSON.stringify(signed(changed)))), /observation/u);
  }
  envelope.signature = Buffer.alloc(64).toString('base64');
  assert.throws(() => read(Buffer.from(JSON.stringify(envelope))), /signature/u);
  const unrelated = { ...f.entry, envelope: { ...f.entry.envelope, keyId: 'another' } };
  assert.throws(() => readBetaObservation(original, unrelated, keySet, LATER), /match/u);
});

test('wrong signing keys, changed catalogues and corrupt receipt readbacks fail closed', async () => {
  const wrong = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  const f = await published();
  await assert.rejects(recordBetaObservation({ ...f.options, privateKeyPem: wrong }), /signature/u);
  assert.equal(f.objects.has(receiptKey), false);
  const fetchImpl = f.options.fetchImpl;
  await assert.rejects(
    recordBetaObservation({
      ...f.options,
      fetchImpl: async (...args) => {
        const response = await fetchImpl(...args);
        f.objects.set(COMMERCIAL_BETA_CATALOG_KEY, Buffer.from('changed'));
        return response;
      },
    }),
    /catalogue changed/u,
  );
  assert.equal(f.objects.has(receiptKey), false);
  const second = await published();
  const put = second.store.put;
  second.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key === receiptKey) second.objects.set(key, Buffer.from('truncated'));
  };
  await assert.rejects(recordBetaObservation(second.options), /receipt readback/u);
});
