import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

export async function smokeFixture(t) {
  const base = resolve(tmpdir());
  const root = await mkdtemp(resolve(base, 'kerfdesk-harness-test-'));
  t.after(async () => {
    if (dirname(root) !== base || !root.includes('kerfdesk-harness-test-')) {
      throw new Error('unexpected disposable test root');
    }
    await rm(root, { recursive: true, force: true });
  });
  return { root, output: resolve(root, 'evidence') };
}

export function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 123;
  child.killCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    return true;
  };
  child.unref = () => {
    child.unreferenced = true;
  };
  return child;
}

export function scriptedSpawn(script, captured = {}) {
  return (executable, args, options) => {
    const child = fakeChild();
    Object.assign(captured, { executable, args, options, child });
    process.nextTick(() => {
      child.emit('spawn');
      Promise.resolve(script(child, args)).catch((error) => {
        child.emit('error', error);
        child.emit('close', 1, null);
      });
    });
    return child;
  };
}

export function smokePaths(args) {
  return {
    userData: args
      .find((arg) => arg.startsWith('--kerfdesk-native-smoke-user-data='))
      .split('=')[1],
    result: args.find((arg) => arg.startsWith('--kerfdesk-native-smoke-result=')).split('=')[1],
  };
}

export function validResult(userData, overrides = {}) {
  return {
    ok: true,
    isPackaged: true,
    isolated: true,
    userData,
    sessionData: userData,
    windowVisible: true,
    failures: [],
    renderer: {
      readyToShow: true,
      imported: true,
      saved: true,
      savedBytes: 2048,
      url: 'app://app/index.html',
    },
    ...overrides,
  };
}

export async function writeSmokeResult(args, overrides = {}) {
  const paths = smokePaths(args);
  await writeFile(paths.result, JSON.stringify(validResult(paths.userData, overrides)));
  return paths;
}

export async function failedSmoke(action) {
  try {
    await action;
  } catch (error) {
    return error;
  }
  throw new Error('expected smoke to fail');
}

export function smokeArgs(fixture) {
  return { executable: process.execPath, output: fixture.output, timeoutMs: 5000 };
}

export function closeChild(child, code = 0) {
  child.emit('exit', code, null);
  child.stdout.end();
  child.stderr.end();
  child.emit('close', code, null);
}

export function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimer(callback, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (next === undefined || next[1].at > until) break;
        now = next[1].at;
        pending.delete(next[0]);
        next[1].callback();
      }
      now = until;
    },
    size: () => pending.size,
  };
}
