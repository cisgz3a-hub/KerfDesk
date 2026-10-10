// Read exact-version code through the beta API; standard content reads are not version-pinned.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const MAX_BODY_BYTES = 1048576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const moduleMimes = ['application/javascript+module', 'text/javascript+module'];
const safeName = (name) => (['worker.js', 'sandbox-worker.js'].includes(name) ? name : null);
const safeMime = (mime) =>
  [...moduleMimes, 'application/json', 'text/html', 'text/plain'].includes(mime) ? mime : null;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

async function boundedJson(response) {
  assert.ok(response.body, 'Exact sandbox version body unavailable.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new Error('Exact sandbox version body unavailable.');
      });
      if (done) break;
      assert.ok(value?.byteLength > 0, 'Exact sandbox version body unavailable.');
      size += value.byteLength;
      assert.ok(size <= MAX_BODY_BYTES, 'Exact sandbox version body exceeds bounds.');
      chunks.push(Buffer.from(value));
    }
    assert.ok(size > 0, 'Exact sandbox version body unavailable.');
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw new Error('Exact sandbox version JSON unavailable.');
    }
  } finally {
    await reader.cancel().catch(() => {
      // Cleanup must not replace the original validation failure.
    });
  }
}

export async function readSandboxVersionContent(
  response,
  expectedVersion,
  expectedSha,
  format = {},
  expectedDescriptor,
) {
  assert.ok(UUID.test(expectedVersion), 'Exact sandbox version UUID unavailable.');
  assert.ok(/^[0-9a-f]{64}$/u.test(expectedSha), 'Sandbox code pin unavailable.');
  const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  format.contentType = safeMime(mime);
  assert.ok(response.ok && mime === 'application/json', 'Exact sandbox version JSON unavailable.');
  const body = await boundedJson(response);
  assert.ok(
    plain(body) && body.success === true && plain(body.result),
    'Exact sandbox version unavailable.',
  );
  const version = body.result;
  format.exactVersion = version.id === expectedVersion;
  assert.equal(format.exactVersion, true, 'Exact sandbox version UUID disagrees.');
  format.packageDependencyCount =
    version.package_dependencies === undefined
      ? 0
      : Array.isArray(version.package_dependencies)
        ? version.package_dependencies.length
        : null;
  assert.equal(
    format.packageDependencyCount,
    0,
    'The retained sandbox module must remain self-contained.',
  );
  format.moduleCount = Array.isArray(version.modules) ? version.modules.length : null;
  assert.equal(format.moduleCount, 1, 'Expected exactly one sandbox version module.');
  const module = version.modules[0];
  assert.ok(plain(module), 'Sandbox version module unavailable.');
  format.singleModule = { name: safeName(module.name), mimeType: safeMime(module.content_type) };
  assert.ok(
    typeof version.main_module === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:m?js)$/u.test(version.main_module) &&
      module.name === version.main_module,
    'Sandbox version module identity unavailable.',
  );
  assert.ok(
    moduleMimes.includes(module.content_type),
    'Sandbox version must remain JavaScript module syntax.',
  );
  const encoded = module.content_base64;
  assert.ok(
    typeof encoded === 'string' &&
      encoded.length > 0 &&
      encoded.length <= MAX_BODY_BYTES &&
      encoded.length % 4 === 0 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded),
    'Sandbox version module encoding unavailable.',
  );
  const bytes = Buffer.from(encoded, 'base64');
  assert.ok(
    bytes.length > 0 && bytes.toString('base64') === encoded,
    'Sandbox version module encoding is not canonical.',
  );
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  Object.assign(format.singleModule, { size: bytes.length, sha256 });
  assert.equal(sha256, expectedSha, 'Sandbox version module is not the attested code.');
  const descriptor = {
    entrypoint: version.main_module,
    filename: module.name,
    mimeType: module.content_type,
  };
  if (expectedDescriptor) {
    for (const key of ['entrypoint', 'filename', 'mimeType']) {
      assert.ok(
        descriptor[key] === expectedDescriptor[key],
        'Sandbox version module descriptor changed.',
      );
    }
  }
  return { ...descriptor, bytes };
}
