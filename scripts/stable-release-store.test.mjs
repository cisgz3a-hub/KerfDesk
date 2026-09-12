import assert from 'node:assert/strict';
import test from 'node:test';
import { createStableReleaseStore } from './stable-release-store.mjs';

const bucket = () => Response.json({ success: true, result: { name: 'kerfdesk-downloads' } });

async function setup(respond) {
  const calls = [];
  const store = await createStableReleaseStore({
    accountId: 'a'.repeat(32),
    apiToken: 'fixture-token',
    fetchRequest: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1 ? bucket() : respond(url, init);
    },
  });
  return { store, calls };
}

test('only a confirmed object 404 is absence after bucket access succeeds', async () => {
  const { store, calls } = await setup(() => new Response('not found', { status: 404 }));
  assert.equal(await store.get('desktop/latest.yml'), null);
  assert.equal(
    calls[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/r2/buckets/kerfdesk-downloads`,
  );
  assert.ok(calls[1].url.endsWith('/objects/desktop/latest.yml'));
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer fixture-token');
  assert.ok(calls[1].init.signal instanceof AbortSignal);
});

test('authentication, rate-limit, server and unexpected response errors fail closed', async () => {
  for (const status of [301, 401, 403, 429, 500, 503]) {
    const { store } = await setup(() => new Response('provider failure', { status }));
    await assert.rejects(store.get('desktop/latest.yml'), new RegExp(`HTTP ${status}`, 'u'));
  }
  const { store } = await setup(() => {
    throw new Error('network timeout');
  });
  await assert.rejects(store.get('desktop/latest.yml'), /network timeout/u);
});

test('a missing or inaccessible bucket cannot be interpreted as an empty release feed', async () => {
  for (const response of [
    new Response('missing', { status: 404 }),
    Response.json({ success: false }),
  ]) {
    await assert.rejects(
      createStableReleaseStore({
        accountId: 'a'.repeat(32),
        apiToken: 'fixture',
        fetchRequest: async () => response,
      }),
      /bucket/u,
    );
  }
});

test('reads exact object bytes and writes raw bytes with explicit cache metadata', async () => {
  const bytes = Buffer.from([0, 5, 255]);
  const { store, calls } = await setup((_url, init) =>
    init.method === 'GET' ? new Response(bytes) : Response.json({ success: true }),
  );
  assert.deepEqual(await store.get('desktop/releases/1.2.3/file.exe'), bytes);
  await store.put('desktop/releases/1.2.3/file.exe', bytes, {
    contentType: 'application/octet-stream',
    cacheControl: 'immutable',
  });
  assert.deepEqual(calls[2].init.body, bytes);
  assert.equal(calls[2].init.headers['Cache-Control'], 'immutable');
});

test('unconfirmed and failed PUTs throw rather than authorising later promotion', async () => {
  for (const response of [
    new Response('denied', { status: 403 }),
    Response.json({ success: false }),
  ]) {
    const { store } = await setup(() => response);
    await assert.rejects(
      store.put('desktop/latest.yml', Buffer.from('feed'), {
        contentType: 'text/yaml',
        cacheControl: 'no-cache',
      }),
    );
  }
});

test('object paths cannot escape the stable release namespace', async () => {
  const { store, calls } = await setup(() => new Response('unused'));
  for (const key of [
    'desktop/../other',
    'other/key',
    'desktop//key',
    'desktop/key?redirect=true',
  ]) {
    await assert.rejects(store.get(key), /object key/u);
  }
  assert.equal(calls.length, 1);
});

test('oversized declared responses are rejected before buffering', async () => {
  const { store } = await setup(
    () => new Response('oversized', { headers: { 'content-length': '300000001' } }),
  );
  await assert.rejects(store.get('desktop/latest.yml'), /object response/u);
});
