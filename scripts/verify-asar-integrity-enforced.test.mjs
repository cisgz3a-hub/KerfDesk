import assert from 'node:assert/strict';
import test from 'node:test';
import { headerTamper, integrityVerdict } from './verify-asar-integrity-enforced.mjs';

function archive(json) {
  const header = Buffer.from(json, 'utf8');
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(header.length + 8, 4);
  prefix.writeUInt32LE(header.length + 4, 8);
  prefix.writeUInt32LE(header.length, 12);
  return { prefix, header };
}

const HEADER =
  '{"files":{"package.json":{"size":2,"offset":"0","integrity":{"algorithm":"SHA256","hash":"9f86d0","blockSize":4194304,"blocks":["9f86d0"]}}}}';

test('changes the first digit of the first file hash and keeps the header valid JSON', () => {
  const { prefix, header } = archive(HEADER);
  const tamper = headerTamper(prefix, header);
  assert.equal(String.fromCharCode(tamper.original), '9');
  assert.equal(String.fromCharCode(tamper.replacement), '0');
  const changed = Buffer.from(header);
  changed[tamper.offset - 16] = tamper.replacement;
  assert.equal(changed.length, header.length);
  assert.equal(JSON.parse(changed.toString()).files['package.json'].integrity.hash, '0f86d0');
});

test('turns a leading 0 into 1 so the byte always changes', () => {
  const { prefix, header } = archive(HEADER.replace('"hash":"9', '"hash":"0'));
  assert.equal(String.fromCharCode(headerTamper(prefix, header).replacement), '1');
});

test('refuses an archive whose header records no hashes', () => {
  const { prefix, header } = archive('{"files":{"package.json":{"size":2,"offset":"0"}}}');
  assert.throws(() => headerTamper(prefix, header), /records no file hashes/);
});

test('refuses a truncated header', () => {
  const { prefix, header } = archive(HEADER);
  assert.throws(() => headerTamper(prefix, header.subarray(0, 10)), /truncated/);
});

const LAUNCH = { code: null, signal: null, timedOut: false, resultWritten: false, stderr: '' };

test('a logged integrity failure counts as refused even if the process lingers', () => {
  const verdict = integrityVerdict({
    ...LAUNCH,
    timedOut: true,
    stderr: '[FATAL:asar_util.cc] Integrity check failed for asar archive (a vs b)',
  });
  assert.equal(verdict.refused, true);
});

test('a crash at launch counts as refused', () => {
  assert.equal(integrityVerdict({ ...LAUNCH, code: 2147483651 }).refused, true);
  assert.equal(integrityVerdict({ ...LAUNCH, signal: 'SIGTRAP' }).refused, true);
});

test('an app that ran, hung or exited cleanly did not refuse the archive', () => {
  assert.match(
    integrityVerdict({ ...LAUNCH, code: 0, resultWritten: true }).reason,
    /started and wrote a smoke result/,
  );
  assert.equal(integrityVerdict({ ...LAUNCH, timedOut: true }).refused, false);
  assert.equal(integrityVerdict({ ...LAUNCH, code: 0 }).refused, false);
});
