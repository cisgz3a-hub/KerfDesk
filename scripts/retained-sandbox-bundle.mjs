// Operator transport for one SHA-pinned sandbox module; never records encoded or source bytes.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';

export function readRetainedSandboxBundle(encoded, expectedSha256) {
  assert.ok(
    typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 65536,
    'Retained sandbox bundle encoding unavailable or oversized.',
  );
  const payload = encoded.trim();
  const compressed = Buffer.from(payload, 'base64');
  assert.ok(compressed.toString('base64') === payload, 'Expected canonical base64.');
  assert.ok(
    compressed.length >= 18 &&
      compressed.length <= 49152 &&
      compressed.subarray(0, 4).equals(Buffer.from([31, 139, 8, 0])),
    'Expected bounded gzip without optional metadata.',
  );
  const options = { maxOutputLength: 72532 };
  const raw = inflateRawSync(compressed.subarray(10), { ...options, info: true });
  assert.ok(
    raw.engine.bytesWritten + 18 === compressed.length,
    'Expected one complete gzip member without trailing bytes.',
  );
  const bytes = gunzipSync(compressed, options);
  assert.ok(bytes.length > 0, 'Retained sandbox module empty.');
  assert.ok(
    crypto.createHash('sha256').update(bytes).digest('hex') === expectedSha256,
    'Retained sandbox module is not the attested code.',
  );
  return {
    entrypoint: 'sandbox-worker.js',
    filename: 'sandbox-worker.js',
    mimeType: 'application/javascript+module',
    bytes,
  };
}
