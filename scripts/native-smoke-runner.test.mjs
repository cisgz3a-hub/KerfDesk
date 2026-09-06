import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { runNativeSmoke } from './verify-windows-packaged-native-smoke.mjs';
import {
  closeChild,
  failedSmoke,
  scriptedSpawn,
  smokeArgs,
  smokeFixture,
  smokePaths,
  writeSmokeResult,
} from './native-smoke-test-support.mjs';

test('launches the tested GUI normally without suppressing its visibility', async (t) => {
  const fixture = await smokeFixture(t);
  const captured = {};
  await runNativeSmoke(
    { executable: process.execPath, output: fixture.output, timeoutMs: 5000 },
    scriptedSpawn(async (child, args) => {
      await writeSmokeResult(args);
      closeChild(child);
    }, captured),
  );
  assert.equal(captured.options.windowsHide, false);
});

test('retains exact malformed result and logs before validation fails', async (t) => {
  const fixture = await smokeFixture(t);
  await assert.rejects(
    runNativeSmoke(
      { executable: process.execPath, output: fixture.output, timeoutMs: 5000 },
      scriptedSpawn(async (child, args) => {
        await writeFile(smokePaths(args).result, '{broken-json\n');
        child.stdout.write('before failure\n');
        child.stderr.write('diagnostic\n');
        closeChild(child, 1);
      }),
    ),
  );
  const entries = await readdir(fixture.output);
  assert.equal(entries.length, 1);
  const evidence = resolve(fixture.output, entries[0]);
  assert.equal(
    await readFile(resolve(evidence, 'native-smoke-result.json'), 'utf8'),
    '{broken-json\n',
  );
  assert.equal(
    await readFile(resolve(evidence, 'native-smoke-stdout.txt'), 'utf8'),
    'before failure\n',
  );
  assert.equal(
    await readFile(resolve(evidence, 'native-smoke-stderr.txt'), 'utf8'),
    'diagnostic\n',
  );
});

test('success preserves correlated evidence before removing only its disposable profile', async (t) => {
  const fixture = await smokeFixture(t);
  const result = await runNativeSmoke(
    smokeArgs(fixture),
    scriptedSpawn(async (child, args) => {
      await writeSmokeResult(args);
      child.stdout.write('imported and saved\n');
      closeChild(child);
    }),
    { tempBase: fixture.root },
  );
  const stored = JSON.parse(
    await readFile(resolve(result.evidenceDirectory, 'manifest.json'), 'utf8'),
  );
  assert.equal(stored.outcome, 'success');
  assert.equal(stored.cleanup, 'removed');
  assert.equal(stored.process.childClosed, true);
  assert.equal(stored.process.logsComplete, true);
  assert.equal(stored.rawResult, 'captured');
  assert.equal(stored.failure, null);
  assert.ok(stored.finishedAt);
  await assert.rejects(stat(stored.profileRoot), { code: 'ENOENT' });
  assert.ok((await stat(result.evidenceDirectory)).isDirectory());
});

for (const scenario of [
  { name: 'invisible', overrides: { windowVisible: false }, code: 0, failure: 'validation' },
  { name: 'unisolated', overrides: { isolated: false }, code: 0, failure: 'validation' },
  { name: 'nonzero exit', overrides: {}, code: 1, failure: 'exit' },
]) {
  test(`retains result and terminal manifest for ${scenario.name}`, async (t) => {
    const fixture = await smokeFixture(t);
    const error = await failedSmoke(
      runNativeSmoke(
        smokeArgs(fixture),
        scriptedSpawn(async (child, args) => {
          await writeSmokeResult(args, scenario.overrides);
          closeChild(child, scenario.code);
        }),
        { tempBase: fixture.root },
      ),
    );
    const stored = JSON.parse(
      await readFile(resolve(error.evidenceDirectory, 'manifest.json'), 'utf8'),
    );
    assert.equal(stored.outcome, 'failure');
    assert.equal(stored.failure.kind, scenario.failure);
    assert.equal(stored.cleanup, 'removed');
    assert.ok(
      (await readFile(resolve(error.evidenceDirectory, 'native-smoke-result.json'))).length > 0,
    );
  });
}

test('a failed new attempt cannot adopt the previous successful result', async (t) => {
  const fixture = await smokeFixture(t);
  const first = await runNativeSmoke(
    smokeArgs(fixture),
    scriptedSpawn(async (child, args) => {
      await writeSmokeResult(args);
      closeChild(child);
    }),
    { tempBase: fixture.root },
  );
  const second = await failedSmoke(
    runNativeSmoke(
      smokeArgs(fixture),
      scriptedSpawn(async (child) => {
        child.stderr.write('no result\n');
        closeChild(child, 1);
      }),
      { tempBase: fixture.root },
    ),
  );
  assert.notEqual(first.evidenceDirectory, second.evidenceDirectory);
  assert.equal((await readdir(fixture.output)).length, 2);
  assert.equal(second.manifest.rawResult, 'missing');
  assert.equal(second.manifest.outcome, 'failure');
  assert.equal(
    JSON.parse(await readFile(resolve(first.evidenceDirectory, 'manifest.json'), 'utf8')).outcome,
    'success',
  );
});

test('spawn throw still records a failed attempt and cleans its unused profile', async (t) => {
  const fixture = await smokeFixture(t);
  const error = await failedSmoke(
    runNativeSmoke(
      smokeArgs(fixture),
      () => {
        throw new Error('spawn unavailable');
      },
      { tempBase: fixture.root },
    ),
  );
  assert.equal(error.manifest.failure.kind, 'spawn-error');
  assert.equal(error.manifest.process.spawned, false);
  assert.equal(error.manifest.cleanup, 'removed');
  assert.equal(error.manifest.rawResult, 'missing');
});
