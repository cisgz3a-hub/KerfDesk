import assert from 'node:assert/strict';
import test from 'node:test';
import { collectNativeSmokeProcess } from './native-smoke-process.mjs';
import { closeChild, fakeChild, fakeClock } from './native-smoke-test-support.mjs';

function fixture() {
  const child = fakeChild();
  const clock = fakeClock();
  const result = collectNativeSmokeProcess(process.execPath, [], {
    spawnProcess: () => child,
    timeoutMs: 1000,
    drainMs: 50,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { child, clock, result };
}

test('captures trailing stdout/stderr until close, not just exit', async () => {
  const { child, clock, result } = fixture();
  child.emit('spawn');
  child.stdout.write('before\n');
  child.emit('exit', 0, null);
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  child.stdout.write('after exit\n');
  child.stderr.write('last diagnostic\n');
  closeChild(child);
  assert.deepEqual(await result, {
    code: 0,
    signal: null,
    spawned: true,
    exited: true,
    childClosed: true,
    logsComplete: true,
    stdout: 'before\nafter exit\n',
    stderr: 'last diagnostic\n',
    failure: null,
    terminationRequested: false,
    terminationAccepted: null,
    errors: [],
  });
  assert.equal(clock.size(), 0);
});

test('an on-time exit with unclosed pipes is a drain failure and never kills an exited PID', async () => {
  const { child, clock, result } = fixture();
  child.emit('spawn');
  clock.advance(999);
  child.emit('exit', 0, null);
  child.stdout.write('partial\n');
  clock.advance(50);
  const observed = await result;
  assert.equal(observed.failure.kind, 'drain-timeout');
  assert.equal(observed.childClosed, false);
  assert.equal(observed.logsComplete, false);
  assert.equal(observed.stdout, 'partial\n');
  assert.equal(child.killCalls, 0);
  assert.equal(child.unreferenced, true);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(child.stdout.listenerCount('error'), 1);
  assert.equal(child.stderr.listenerCount('error'), 1);
  child.emit('error', new Error('late error'));
  closeChild(child);
  assert.equal((await result).childClosed, false);
  assert.equal(clock.size(), 0);
});

test('a nonzero exit remains the primary cause if the output streams never close', async () => {
  const { child, clock, result } = fixture();
  child.emit('spawn');
  child.emit('exit', 7, null);
  clock.advance(50);
  const observed = await result;
  assert.equal(observed.failure.kind, 'exit');
  assert.equal(observed.code, 7);
  assert.equal(observed.childClosed, false);
  assert.equal(child.killCalls, 0);
});

test('runtime timeout stays failed after a late success marker and clean exit', async () => {
  const { child, clock, result } = fixture();
  child.emit('spawn');
  clock.advance(1000);
  assert.equal(child.killCalls, 1);
  child.stdout.write('NATIVE_SMOKE_OK=true\n');
  closeChild(child);
  const observed = await result;
  assert.equal(observed.failure.kind, 'timeout');
  assert.equal(observed.code, 0);
  assert.equal(observed.childClosed, true);
  assert.equal(clock.size(), 0);
});

test('synchronous spawn failure has no child to clean up', async () => {
  const clock = fakeClock();
  const observed = await collectNativeSmokeProcess(process.execPath, [], {
    spawnProcess: () => {
      throw new Error('cannot spawn');
    },
    timeoutMs: 1000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  assert.equal(observed.failure.kind, 'spawn-error');
  assert.equal(observed.spawned, false);
  assert.equal(observed.childClosed, true);
  assert.equal(clock.size(), 0);
});

test('pre-spawn error followed by close is not a successful launch', async () => {
  const { child, clock, result } = fixture();
  child.emit('error', new Error('ENOENT'));
  child.emit('close', -1, null);
  assert.equal((await result).failure.kind, 'spawn-error');
  assert.equal(child.killCalls, 0);
  assert.equal(clock.size(), 0);
});

test('post-spawn errors request termination only once, including a synchronous kill error', async () => {
  const { child, clock, result } = fixture();
  child.emit('spawn');
  child.kill = () => {
    child.killCalls += 1;
    child.emit('error', new Error('kill rejected'));
    return false;
  };
  child.emit('error', new Error('process broke'));
  clock.advance(50);
  const observed = await result;
  assert.equal(observed.failure.kind, 'process-error');
  assert.equal(observed.failure.message, 'process broke');
  assert.deepEqual(observed.errors, ['process broke', 'kill rejected']);
  assert.equal(observed.terminationAccepted, false);
  assert.equal(child.killCalls, 1);
});

test('kill throw and missing close retain the primary timeout and partial logs', async () => {
  const { child, clock, result } = fixture();
  child.emit('spawn');
  child.stderr.write('shutdown diagnostic');
  child.kill = () => {
    child.killCalls += 1;
    throw new Error('permission denied');
  };
  clock.advance(1050);
  const observed = await result;
  assert.equal(observed.failure.kind, 'timeout');
  assert.equal(observed.childClosed, false);
  assert.deepEqual(observed.errors, ['termination failed: permission denied']);
  assert.equal(observed.stderr, 'shutdown diagnostic');
  assert.equal(child.killCalls, 1);
});

test('a pipe error is recorded without an unhandled EventEmitter error', async () => {
  const { child, result } = fixture();
  child.emit('spawn');
  child.stderr.emit('error', new Error('read failed'));
  closeChild(child, 1);
  assert.equal((await result).failure.kind, 'stderr-error');
  assert.equal(child.killCalls, 1);
});
