import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStableReleaseStore,
  printableStorageFailure,
  ReleaseStorageError,
} from './stable-release-store.mjs';

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
  await assert.rejects(store.get('desktop/latest.yml'), /read failed: request or transport error/u);
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
  let reads = 0;
  let cancellations = 0;
  const body = new ReadableStream(
    {
      pull() {
        reads += 1;
      },
      cancel() {
        cancellations += 1;
      },
    },
    { highWaterMark: 0 },
  );
  const { store } = await setup(
    () => new Response(body, { headers: { 'content-length': '300000001' } }),
  );
  await assert.rejects(store.get('desktop/latest.yml'), /object response/u);
  assert.equal(reads, 0);
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
});

test('a null object body is invalid without trying to cancel it', async () => {
  const { store } = await setup(() => new Response(null));
  await assert.rejects(store.get('desktop/latest.yml'), /object response/u);
});

test('an oversized response remains rejected when cancellation fails', async () => {
  const cancellationError = new Error('synthetic cancellation failure');
  const body = new ReadableStream({ cancel: () => Promise.reject(cancellationError) });
  const { store } = await setup(
    () => new Response(body, { headers: { 'content-length': '300000001' } }),
  );
  await assert.rejects(store.get('desktop/latest.yml'), (error) => {
    assert.ok(error instanceof ReleaseStorageError);
    assert.equal(error.message, 'Release storage read failed: invalid object response.');
    assert.equal(error.cause, undefined);
    return true;
  });
});

const releasePrefix = 'desktop/commercial-manual/releases/';
const listing = (keys, isTruncated = false, cursor) =>
  Response.json({
    success: true,
    result: keys.map((key) => ({ key })),
    result_info: { is_truncated: isTruncated, cursor },
  });

test('release history listing follows bounded provider cursors within the requested prefix', async () => {
  const first = `${releasePrefix}1.0.0/download-manifest.json`;
  const second = `${releasePrefix}1.1.0/download-manifest.json`;
  const { store, calls } = await setup((url) =>
    new URL(url).searchParams.has('cursor')
      ? listing([second])
      : listing([first], true, 'next+page/='),
  );
  assert.deepEqual(await store.list(releasePrefix), [first, second]);
  assert.equal(calls.length, 3);
  for (const { url, init } of calls.slice(1)) {
    assert.equal(new URL(url).searchParams.get('prefix'), releasePrefix);
    assert.equal(new URL(url).searchParams.get('per_page'), '1000');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer fixture-token');
  }
  assert.equal(new URL(calls[2].url).searchParams.get('cursor'), 'next+page/=');
});

test('Cloudflare history listing accepts a short terminal page without result_info', async () => {
  // Authenticated Cloudflare response: 25 entries with pagination, then 21
  // terminal entries with no result_info field at all.
  const first = Array.from({ length: 25 }, (_, i) => `${releasePrefix}first-${i}.json`);
  const terminal = Array.from({ length: 21 }, (_, i) => `${releasePrefix}last-${i}.json`);
  const { store, calls } = await setup((url) =>
    new URL(url).searchParams.has('cursor')
      ? Response.json({ success: true, result: terminal.map((key) => ({ key })) })
      : Response.json({
          success: true,
          result: first.map((key) => ({ key })),
          result_info: { is_truncated: true, cursor: 'next-page', per_page: 25 },
        }),
  );
  assert.deepEqual(await store.list(releasePrefix), [...first, ...terminal]);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[2].url).searchParams.get('cursor'), 'next-page');
});

test('a short first page without result_info is terminal, including an empty bucket prefix', async () => {
  for (const keys of [[], [`${releasePrefix}file.json`]]) {
    const { store, calls } = await setup(() =>
      Response.json({ success: true, result: keys.map((key) => ({ key })) }),
    );
    assert.deepEqual(await store.list(releasePrefix), keys);
    assert.equal(calls.length, 2);
  }
});

test('full pages without explicit completion fail closed at the requested or provider page size', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => `${releasePrefix}file-${i}.json`);
  const { store } = await setup(() =>
    Response.json({ success: true, result: full.map((key) => ({ key })) }),
  );
  await assert.rejects(store.list(releasePrefix), /incomplete listing pagination/u);
  const paged = await setup((url) =>
    new URL(url).searchParams.has('cursor')
      ? Response.json({ success: true, result: full.slice(0, 25).map((key) => ({ key })) })
      : Response.json({
          success: true,
          result: [],
          result_info: { is_truncated: true, cursor: 'next', per_page: 25 },
        }),
  );
  await assert.rejects(paged.store.list(releasePrefix), /incomplete listing pagination/u);
  const complete = await setup(() => listing(full));
  assert.deepEqual(await complete.store.list(releasePrefix), full);
});

test('present listing metadata and cursors must remain well formed', async () => {
  for (const resultInfo of [
    null,
    [],
    {},
    { is_truncated: 'false' },
    { is_truncated: true },
    { is_truncated: true, cursor: '' },
    { is_truncated: true, cursor: 'x'.repeat(8193) },
    { is_truncated: false, cursor: {} },
    ...[0, -1, 1001, 1.5, '25', null].map((per_page) => ({ is_truncated: false, per_page })),
  ]) {
    const { store } = await setup(() =>
      Response.json({ success: true, result: [], result_info: resultInfo }),
    );
    await assert.rejects(store.list(releasePrefix), /listing pagination/u);
  }
  const { store } = await setup(() =>
    Response.json({
      success: true,
      result: [{ key: `${releasePrefix}one` }, { key: `${releasePrefix}two` }],
      result_info: { is_truncated: false, per_page: 1 },
    }),
  );
  await assert.rejects(store.list(releasePrefix), /listing pagination/u);
});

test('listing still rejects duplicates across pages and caps cursor pages and total objects', async () => {
  const duplicate = await setup((url) =>
    listing([`${releasePrefix}duplicate`], !new URL(url).searchParams.has('cursor'), 'next'),
  );
  await assert.rejects(duplicate.store.list(releasePrefix), /object key/u);
  let page = 0;
  const endless = await setup(() => listing([], true, `page-${page++}`));
  await assert.rejects(endless.store.list(releasePrefix), /listing pagination/u);
  assert.equal(endless.calls.length, 18); // Bucket access plus at most 17 listing pages.
  page = 0;
  const oversized = await setup(() =>
    listing(
      Array.from({ length: 1000 }, (_, i) => `${releasePrefix}file-${page * 1000 + i}`),
      true,
      `page-${page++}`,
    ),
  );
  await assert.rejects(oversized.store.list(releasePrefix), /size or page limit/u);
  assert.equal(oversized.calls.length, 6);
});

test('history listing rejects failed or incomplete provider responses and unsafe object names', async () => {
  for (const respond of [
    () => new Response('denied', { status: 403 }),
    () => Response.json({ success: false, result: [] }),
    () => Response.json({ success: true, result: [], result_info: {} }),
    () => listing([], true),
    () => listing([], true, 'repeated'),
    () => listing([`${releasePrefix}../secrets`]),
    () => listing(['desktop/commercial/releases/1.0.0/file.exe']),
    () => listing([`${releasePrefix}file.exe`, `${releasePrefix}file.exe`]),
    () => new Response('x', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
  ]) {
    const { store } = await setup(respond);
    await assert.rejects(store.list(releasePrefix));
  }
  const { store, calls } = await setup(() => listing([]));
  for (const prefix of ['desktop/../', 'other/', 'desktop//', 'desktop/commercial-manual'])
    await assert.rejects(store.list(prefix), /(?:object key|prefix)/u);
  assert.equal(calls.length, 1);
});

test('typed storage diagnostics expose only fixed labels and validated HTTP status numbers', async () => {
  const secret = 'synthetic-secret-token-provider-text';
  for (const [respond, expected] of [
    [() => new Response(secret, { status: 403 }), 'Release storage list failed: HTTP 403.'],
    [
      () => {
        throw new Error(`https://provider.invalid/${secret}`);
      },
      'Release storage list failed: request or transport error.',
    ],
    [() => new Response(`{${secret}`), 'Release storage list failed: invalid JSON response.'],
    [
      () => Response.json({ success: true, result: [], result_info: { is_truncated: secret } }),
      'Release storage list failed: invalid or incomplete listing pagination.',
    ],
  ]) {
    const { store } = await setup(respond);
    await assert.rejects(store.list(releasePrefix), (error) => {
      assert.ok(error instanceof ReleaseStorageError);
      assert.equal(error.message, expected);
      assert.equal(printableStorageFailure(error), expected);
      assert.equal(error.cause, undefined);
      error.message = secret;
      error.stack = secret;
      error.cause = new Error(secret);
      assert.equal(printableStorageFailure(error), expected);
      return true;
    });
  }
  assert.equal(
    printableStorageFailure(new ReleaseStorageError(secret, secret, secret)),
    'Release storage operation failed: invalid provider response.',
  );
  assert.equal(printableStorageFailure(new Error(secret)), null);
  assert.equal(printableStorageFailure({ name: 'ReleaseStorageError', message: secret }), null);
});
