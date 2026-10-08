import test from 'node:test';
import assert from 'node:assert/strict';
import { readCloudflareFailure } from './cloudflare-error-diagnostics.mjs';

const privateValue = 'arbitrary-private-token-never-printed';
const source = 'export const confidentialSource = "' + privateValue + '";';
const errorBody = (errors) => ({ success: false, errors, result: source, messages: [source] });

test('diagnostics expose only numeric codes, fixed categories/types/identifiers and metadata shapes', async () => {
  const form = new FormData();
  form.set(
    'metadata',
    JSON.stringify({
      main_module: privateValue,
      bindings: [{ name: privateValue, text: privateValue }],
      tail_consumers: null,
      observability: null,
      compatibility_flags: [],
      placement: { confidential: privateValue },
      unknownPrivateField: source,
    }),
  );
  const response = Response.json(
    errorBody([
      {
        code: 10021,
        message:
          'Uncaught TypeError: SandboxLicenseAuthority inherits ASSETS binding; ' +
          'metadata migration for LICENSE_AUTHORITY REQUEST_RATE_LIMITER; ' +
          privateValue +
          source,
        documentation_url: privateValue,
        source: { pointer: source },
      },
    ]),
    { status: 400 },
  );
  const diagnostic = await readCloudflareFailure(response, form);
  assert.deepEqual(diagnostic.errors, {
    codes: [10021],
    categories: [
      'binding-inheritance',
      'assets',
      'durable-object',
      'upload-metadata',
      'script-validation',
    ],
    exceptionTypes: ['TypeError'],
    identifiers: ['SandboxLicenseAuthority', 'ASSETS', 'LICENSE_AUTHORITY', 'REQUEST_RATE_LIMITER'],
    truncated: false,
  });
  assert.deepEqual(diagnostic.metadataShape, {
    types: {
      bindings: 'array',
      main_module: 'string',
      compatibility_flags: 'array',
      tail_consumers: 'null',
      observability: 'null',
      placement: 'object',
    },
    nullKeys: ['tail_consumers', 'observability'],
  });
  for (const value of [privateValue, source, 'unknownPrivateField', 'documentation_url'])
    assert.ok(!JSON.stringify(diagnostic).includes(value));
});

test('codes remain bounded integers, unknown names stay absent, and messages/errors are capped', async () => {
  const errors = [
    { code: 10021, message: privateValue + 'UnrecognisedPrivateError' },
    { code: 10021, message: 'prefixASSETSsuffix namespaceSecret' },
    { code: '10022', message: privateValue },
    { code: 1.5, message: privateValue },
    { code: 999, message: privateValue },
    { code: 1000000, message: privateValue },
    { code: 10022, message: 'x'.repeat(4096) + 'TypeError ASSETS' },
    { code: 10023, message: privateValue },
    { code: 10024, message: 'TypeError ASSETS' },
  ];
  const diagnostic = await readCloudflareFailure(Response.json(errorBody(errors), { status: 400 }));
  assert.deepEqual(diagnostic.errors, {
    codes: [10021, 10022, 10023],
    categories: ['unclassified'],
    exceptionTypes: [],
    identifiers: [],
    truncated: true,
  });
  assert.equal(diagnostic.metadataShape, null);
  assert.ok(!JSON.stringify(diagnostic).includes(privateValue));
});

test('malformed/HTML/missing/oversized/read-failure bodies return unavailable without payload text', async () => {
  const responses = [
    new Response('<html>' + privateValue + '</html>'),
    new Response('{"error":'),
    Response.json({ errors: [{ code: 10021 }], success: true }),
    Response.json(errorBody([])),
    Response.json(errorBody([null, [], privateValue])),
    new Response(null, { status: 400 }),
    new Response('x'.repeat(32769)),
    new Response(new Uint8Array([255, 254])),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error(privateValue));
        },
      }),
    ),
    {
      body: {
        getReader() {
          throw new Error(privateValue);
        },
      },
    },
  ];
  for (const response of responses) {
    const diagnostic = await readCloudflareFailure(response);
    assert.deepEqual(diagnostic, { errors: null, metadataShape: null });
    assert.ok(!JSON.stringify(diagnostic).includes(privateValue));
  }
});

test('streamed JSON observes byte bounds and discards unknown or oversized request metadata', async () => {
  const encoded = JSON.stringify(errorBody([{ code: 10021, message: 'SyntaxError ASSETS' }]));
  const chunks = [encoded.slice(0, 7), encoded.slice(7)];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  );
  const form = new FormData();
  form.set('metadata', 'x'.repeat(32769));
  const diagnostic = await readCloudflareFailure(response, form);
  assert.deepEqual(diagnostic.errors.exceptionTypes, ['SyntaxError']);
  assert.deepEqual(diagnostic.errors.identifiers, ['ASSETS']);
  assert.equal(diagnostic.metadataShape, null);
  form.set('metadata', JSON.stringify({ [privateValue]: privateValue }));
  const emptyKnownShape = await readCloudflareFailure(new Response(null), form);
  assert.deepEqual(emptyKnownShape.metadataShape, { types: {}, nullKeys: [] });
});

test('zero-byte chunks refuse immediately so a microtask stream cannot starve the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  let cancelled = false;
  const response = {
    body: {
      getReader: () => ({
        read: async () => {
          if (++reads > 50) throw new Error('Finite test safety guard: ' + privateValue);
          return { done: false, value: new Uint8Array(0) };
        },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
  };
  assert.deepEqual(await readCloudflareFailure(response), { errors: null, metadataShape: null });
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
});

test('an unfinished provider body has a two-second deadline and is cancelled without real waits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const pending = readCloudflareFailure(response);
  t.mock.timers.tick(2000);
  assert.deepEqual(await pending, { errors: null, metadataShape: null });
  assert.equal(cancelled, true);
});
