import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readSandboxVersionContent } from './sandbox-version-content.mjs';

const version = '00000000-0000-4000-8000-000000000001';
const otherVersion = '00000000-0000-4000-8000-000000000002';
const code = Buffer.from('export default { fetch() { return new Response("fixture"); } };');
const sha = crypto.createHash('sha256').update(code).digest('hex');
const privateValue = 'private-fixture-value';
const descriptor = {
  entrypoint: 'worker.js',
  filename: 'worker.js',
  mimeType: 'application/javascript+module',
};
function body() {
  return {
    success: true,
    result: {
      id: version,
      main_module: 'worker.js',
      modules: [
        {
          name: 'worker.js',
          content_type: descriptor.mimeType,
          content_base64: code.toString('base64'),
        },
      ],
    },
  };
}
const response = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const read = (value = body(), format = {}, expectedDescriptor = descriptor) =>
  readSandboxVersionContent(response(value), version, sha, format, expectedDescriptor);

test('exact beta UUID single-module bytes and descriptor verify', async () => {
  const format = {};
  const result = await read(body(), format);
  assert.deepEqual(result, { ...descriptor, bytes: code });
  assert.equal(format.exactVersion, true);
  assert.equal(format.moduleCount, 1);
  assert.equal(format.singleModule.sha256, sha);
});
test('wrong or missing version identity fails even with correct module bytes', async () => {
  for (const id of [undefined, otherVersion, privateValue]) {
    const value = body();
    value.result.id = id;
    const format = {};
    await assert.rejects(read(value, format));
    assert.equal(format.exactVersion, false);
    assert.ok(!JSON.stringify(format).includes(privateValue));
  }
});
test('missing or error result, malformed JSON and non-JSON responses refuse privately', async () => {
  for (const value of [
    null,
    {},
    { success: false, errors: [{ message: privateValue }] },
    { success: true, result: [] },
  ])
    await assert.rejects(read(value));
  for (const result of [
    new Response(privateValue, { headers: { 'content-type': 'application/json' } }),
    new Response(privateValue, { headers: { 'content-type': 'text/html' } }),
    new Response(privateValue, { status: 503, headers: { 'content-type': 'application/json' } }),
  ]) {
    await assert.rejects(
      readSandboxVersionContent(result, version, sha),
      (error) => !String(error).includes(privateValue),
    );
  }
});
test('absent empty multiple and nonobject modules refuse', async () => {
  for (const modules of [
    undefined,
    [],
    {},
    [null],
    [body().result.modules[0], body().result.modules[0]],
  ]) {
    const value = body();
    value.result.modules = modules;
    await assert.rejects(read(value));
  }
});
test('self-contained retained code permits absent or empty package dependencies only', async () => {
  const empty = body();
  empty.result.package_dependencies = [];
  assert.deepEqual((await read(empty)).bytes, code);
  for (const dependencies of [null, {}, privateValue, [privateValue], [{ name: privateValue }]]) {
    const value = body();
    value.result.package_dependencies = dependencies;
    const format = {};
    await assert.rejects(read(value, format), /self-contained/u);
    assert.ok(!JSON.stringify(format).includes(privateValue));
  }
});
test('entrypoint name mismatch path traversal and oversized names refuse', async () => {
  for (const name of [undefined, 'other.js', '../worker.js', 'x'.repeat(129) + '.js']) {
    const value = body();
    value.result.main_module = name;
    await assert.rejects(read(value));
  }
  const value = body();
  value.result.modules[0].name = privateValue;
  const format = {};
  await assert.rejects(read(value, format));
  assert.equal(format.singleModule.name, null);
});
test('non-module MIME refuses and unknown MIME stays redacted', async () => {
  for (const mime of ['application/javascript', 'application/json', privateValue, undefined]) {
    const value = body();
    value.result.modules[0].content_type = mime;
    const format = {};
    await assert.rejects(read(value, format));
    assert.ok(!JSON.stringify(format).includes(privateValue));
  }
});
test('base64 must be nonempty canonical padded bounded and unmodified', async () => {
  for (const content of [
    undefined,
    '',
    ' ',
    'Zg',
    'Zh==',
    'Zg===',
    'Zg==\n',
    '-w==',
    'x'.repeat(1048577),
    'Zg==',
  ]) {
    const value = body();
    value.result.modules[0].content_base64 = content;
    await assert.rejects(read(value));
  }
});
test('one-byte content changes refuse retained hash attestation', async () => {
  const value = body();
  const changed = Buffer.from(code);
  changed[0] ^= 1;
  value.result.modules[0].content_base64 = changed.toString('base64');
  await assert.rejects(read(value), /not the attested code/u);
});
test('matching code cannot conceal changed uploaded name or MIME', async () => {
  for (const expected of [
    { ...descriptor, entrypoint: 'other.js' },
    { ...descriptor, filename: privateValue },
    { ...descriptor, mimeType: 'text/javascript+module' },
  ]) {
    await assert.rejects(
      read(body(), {}, expected),
      (error) => !String(error).includes(privateValue),
    );
  }
});
test('both declared module MIME forms work only with matching expected identity', async () => {
  const value = body();
  value.result.modules[0].content_type = 'text/javascript+module';
  assert.deepEqual(
    (await read(value, {}, { ...descriptor, mimeType: 'text/javascript+module' })).bytes,
    code,
  );
});
test('body byte bound applies to unknown metadata and malformed UTF-8 refuses', async () => {
  const value = body();
  value.unrelated = 'x'.repeat(1048576);
  await assert.rejects(read(value), /exceeds bounds/u);
  const invalidUtf8 = Buffer.concat([
    Buffer.from('{"value":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]);
  await assert.rejects(
    readSandboxVersionContent(
      new Response(invalidUtf8, { headers: { 'content-type': 'application/json' } }),
      version,
      sha,
    ),
    /JSON unavailable/u,
  );
});
test('empty chunks and stream failure refuse without forwarding private stream errors', async () => {
  for (const stream of [
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array());
        controller.close();
      },
    }),
    new ReadableStream({
      start(controller) {
        controller.error(new Error(privateValue));
      },
    }),
  ]) {
    await assert.rejects(
      readSandboxVersionContent(
        new Response(stream, { headers: { 'content-type': 'application/json' } }),
        version,
        sha,
      ),
      (error) => !String(error).includes(privateValue),
    );
  }
});
test('receipt diagnostics never copy unknown fields names metadata or source bytes', async () => {
  const value = body();
  value.result.author_email = privateValue;
  value.result.modules[0].unknown = privateValue;
  value.result.main_module = 'private-fixture-value.js';
  value.result.modules[0].name = value.result.main_module;
  const format = {};
  const result = await read(value, format, null);
  assert.deepEqual(result.bytes, code);
  assert.equal(format.singleModule.name, null);
  assert.ok(!JSON.stringify(format).includes(privateValue));
  assert.ok(!JSON.stringify(format).includes(code.toString()));
});
