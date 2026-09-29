import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validResult } from './native-smoke-test-support.mjs';
import {
  headerTamper,
  integrityVerdict,
  verifyAsarIntegrity,
} from './verify-asar-integrity-enforced.mjs';

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

const LAUNCH = {
  code: null,
  signal: null,
  timedOut: false,
  resultWritten: false,
  stderr: '',
  spawned: true,
  childClosed: true,
  errors: [],
};
const DIAGNOSTIC = '[FATAL:asar_util.cc] Integrity check failed for asar archive (a vs b)';

test('a logged integrity failure counts once the owned process has closed', () => {
  const verdict = integrityVerdict({
    ...LAUNCH,
    timedOut: true,
    stderr: DIAGNOSTIC,
  });
  assert.equal(verdict.refused, true);
});

test('unrelated nonzero exits and fatal signals are not integrity evidence', () => {
  for (const code of [null, 1, 2147483651]) {
    assert.equal(integrityVerdict({ ...LAUNCH, code }).refused, false);
  }
  assert.equal(integrityVerdict({ ...LAUNCH, signal: 'SIGTRAP' }).refused, false);
});

test('spawn failure and process observation failure never count as integrity enforcement', () => {
  assert.equal(
    integrityVerdict({ ...LAUNCH, spawned: false, stderr: 'spawn failed: missing.exe ENOENT' })
      .refused,
    false,
  );
  assert.equal(
    integrityVerdict({ ...LAUNCH, errors: ['stderr failed'], stderr: DIAGNOSTIC }).refused,
    false,
  );
  assert.equal(
    integrityVerdict({ ...LAUNCH, childClosed: false, stderr: DIAGNOSTIC }).refused,
    false,
  );
});

function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'kerfdesk-integrity-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const archivePath = join(root, 'app.asar');
  const { prefix, header } = archive(HEADER);
  const bytes = Buffer.concat([prefix, header, Buffer.from('{}')]);
  writeFileSync(archivePath, bytes);
  const userData = join(root, 'profile');
  const baseline = {
    ...LAUNCH,
    code: 0,
    failure: null,
    resultWritten: true,
    userData,
    smokeResult: validResult(userData),
  };
  return { archivePath, bytes, baseline };
}

test('checks the untouched package first, then restores the exact bytes after a proven refusal', async (context) => {
  const { archivePath, bytes, baseline } = fixture(context);
  let calls = 0;
  const result = await verifyAsarIntegrity('fixture', archivePath, 1000, async () => {
    calls += 1;
    if (calls === 1) {
      assert.deepEqual(readFileSync(archivePath), bytes);
      return baseline;
    }
    assert.notDeepEqual(readFileSync(archivePath), bytes);
    return { ...LAUNCH, stderr: DIAGNOSTIC };
  });
  assert.equal(calls, 2);
  assert.equal(result.verdict.refused, true);
  assert.deepEqual(readFileSync(archivePath), bytes);
});

test('does not tamper if the unmodified executable fails or writes an invalid smoke result', async (context) => {
  const { archivePath, bytes, baseline } = fixture(context);
  for (const bad of [
    { ...baseline, code: 1 },
    { ...baseline, spawned: false },
    { ...baseline, childClosed: false },
    { ...baseline, failure: { kind: 'timeout' } },
    { ...baseline, smokeResult: {} },
  ]) {
    let calls = 0;
    await assert.rejects(
      verifyAsarIntegrity('fixture', archivePath, 1000, async () => {
        calls += 1;
        return bad;
      }),
    );
    assert.equal(calls, 1);
    assert.deepEqual(readFileSync(archivePath), bytes);
  }
});

test('restores the exact archive after a failed tampered launch or observer exception', async (context) => {
  const { archivePath, bytes, baseline } = fixture(context);
  for (const throws of [false, true]) {
    let calls = 0;
    await assert.rejects(
      verifyAsarIntegrity('fixture', archivePath, 1000, async () => {
        if (calls++ === 0) return baseline;
        if (throws) throw new Error('observer failed');
        return { ...LAUNCH, code: 1 };
      }),
    );
    assert.deepEqual(readFileSync(archivePath), bytes);
  }
});

test('an app that ran, hung or exited cleanly did not refuse the archive', () => {
  assert.match(
    integrityVerdict({ ...LAUNCH, code: 0, resultWritten: true }).reason,
    /started and wrote a smoke result/,
  );
  assert.equal(integrityVerdict({ ...LAUNCH, timedOut: true }).refused, false);
  assert.equal(integrityVerdict({ ...LAUNCH, code: 0 }).refused, false);
});
