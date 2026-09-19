import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInstallerVerifier } from './publish-stable-release.mjs';

const directory = join(tmpdir(), 'kerfdesk-stable-signature-fixture');
const bytes = Buffer.from('synthetic installer');

function verificationFixture({ writeError, signatureError, cleanupError, stderrError } = {}) {
  const calls = [];
  const messages = [];
  const verify = createInstallerVerifier({
    io: {
      async mkdtemp(prefix) {
        calls.push(['mkdtemp', prefix]);
        return directory;
      },
      async writeFile(...args) {
        calls.push(['writeFile', ...args]);
        if (writeError) throw writeError;
      },
      async rm(...args) {
        calls.push(['rm', ...args]);
        if (cleanupError) throw cleanupError;
      },
    },
    async execute(...args) {
      calls.push(['execute', ...args]);
      if (signatureError) throw signatureError;
    },
    stderr: {
      write(message) {
        messages.push(message);
        if (stderrError) throw stderrError;
      },
    },
  });
  return { verify, calls, messages };
}

test('installer verification checks the owned temporary executable and removes its directory', async () => {
  const { verify, calls, messages } = verificationFixture();
  await verify(bytes, 'remote');
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['mkdtemp', 'writeFile', 'execute', 'rm'],
  );
  assert.equal(calls[0][1], join(tmpdir(), 'kerfdesk-stable-signature-'));
  assert.deepEqual(calls[1], ['writeFile', join(directory, 'installer.exe'), bytes]);
  assert.equal(calls[2][1], 'pwsh');
  assert.match(calls[2][2].at(-1), /Get-AuthenticodeSignature/u);
  assert.equal(calls[2][3].env.KERFDESK_RELEASE_VERIFY_PATH, join(directory, 'installer.exe'));
  assert.equal(calls[2][3].windowsHide, true);
  assert.deepEqual(calls[3], ['rm', directory, { recursive: true, force: true }]);
  assert.deepEqual(messages, []);
});

for (const stage of ['write', 'signature']) {
  test(`${stage} error survives a simultaneous cleanup failure with resource details reported`, async () => {
    const primaryError = Object.freeze(new Error(`synthetic ${stage} failure`));
    const cleanupError = Object.assign(new Error('synthetic cleanup failure'), {
      code: 'EPERM',
      path: join(directory, 'installer.exe'),
    });
    const { verify, calls, messages } = verificationFixture({
      [`${stage}Error`]: primaryError,
      cleanupError,
    });
    await assert.rejects(verify(bytes), (error) => error === primaryError);
    assert.equal(calls.at(-1)[0], 'rm');
    assert.equal(
      calls.some((call) => call[0] === 'execute'),
      stage === 'signature',
    );
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes(directory));
    assert.match(messages[0], /partially removed/u);
    assert.match(messages[0], /synthetic cleanup failure/u);
    assert.match(messages[0], /EPERM/u);
    assert.match(messages[0], /installer\.exe/u);
  });
}

test('a cleanup-only failure still rejects an otherwise verified installer', async () => {
  const cleanupError = new Error('synthetic cleanup failure');
  const { verify, calls, messages } = verificationFixture({ cleanupError });
  await assert.rejects(verify(bytes), (error) => error === cleanupError);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['mkdtemp', 'writeFile', 'execute', 'rm'],
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0], /synthetic cleanup failure/u);
});

test('unavailable diagnostic output cannot replace the original verification error', async () => {
  const signatureError = new Error('synthetic signature failure');
  const { verify } = verificationFixture({
    signatureError,
    cleanupError: new Error('synthetic cleanup failure'),
    stderrError: new Error('synthetic stderr failure'),
  });
  await assert.rejects(verify(bytes), (error) => error === signatureError);
});
