import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { runNativeSmoke } from './verify-windows-packaged-native-smoke.mjs';
import {
  closeChild,
  failedSmoke,
  fakeClock,
  scriptedSpawn,
  smokeArgs,
  smokeFixture,
  writeSmokeResult,
} from './native-smoke-test-support.mjs';

async function pendingSmoke(t) {
  const fixture = await smokeFixture(t);
  const clock = fakeClock();
  let ready;
  const prepared = new Promise((resolveReady) => {
    ready = resolveReady;
  });
  const completion = failedSmoke(
    runNativeSmoke(
      smokeArgs(fixture),
      scriptedSpawn(async (child, args) => {
        await writeSmokeResult(args);
        child.stdout.write('captured\n');
        ready({ child, args });
      }),
      {
        tempBase: fixture.root,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        drainMs: 50,
      },
    ),
  );
  return { clock, completion, ...(await prepared) };
}

test('unconfirmed timeout retains profile and partial evidence, and late events cannot republish', async (t) => {
  const { child, clock, completion } = await pendingSmoke(t);
  clock.advance(5050);
  const error = await completion;
  assert.equal(error.manifest.failure.kind, 'timeout');
  assert.equal(error.manifest.process.childClosed, false);
  assert.equal(error.manifest.process.logsComplete, false);
  assert.equal(error.manifest.cleanup, 'retained');
  assert.equal(child.killCalls, 1);
  assert.ok((await stat(error.manifest.profileRoot)).isDirectory());
  const manifestPath = resolve(error.evidenceDirectory, 'manifest.json');
  const before = await readFile(manifestPath, 'utf8');
  closeChild(child);
  child.emit('error', new Error('late shutdown'));
  clock.advance(10000);
  await Promise.resolve();
  assert.equal(await readFile(manifestPath, 'utf8'), before);
  assert.equal(
    await readFile(resolve(error.evidenceDirectory, 'native-smoke-stdout.txt'), 'utf8'),
    'captured\n',
  );
});

test('late valid result and exit zero do not convert a runtime timeout to success', async (t) => {
  const { child, clock, completion } = await pendingSmoke(t);
  clock.advance(5000);
  child.stdout.write('NATIVE_SMOKE_OK=true\n');
  closeChild(child);
  const error = await completion;
  assert.equal(error.manifest.failure.kind, 'timeout');
  assert.equal(error.manifest.process.code, 0);
  assert.equal(error.manifest.validationFailure, null);
  assert.equal(error.manifest.cleanup, 'removed');
  assert.equal(
    JSON.parse(await readFile(resolve(error.evidenceDirectory, 'manifest.json'), 'utf8')).outcome,
    'failure',
  );
});

test('on-time exit without stdio close retains profile as a drain failure without a kill', async (t) => {
  const { child, clock, completion } = await pendingSmoke(t);
  clock.advance(4999);
  child.emit('exit', 0, null);
  clock.advance(50);
  const error = await completion;
  assert.equal(error.manifest.failure.kind, 'drain-timeout');
  assert.equal(error.manifest.process.exited, true);
  assert.equal(error.manifest.process.childClosed, false);
  assert.equal(error.manifest.cleanup, 'retained');
  assert.equal(child.killCalls, 0);
  assert.equal(child.unreferenced, true);
});
