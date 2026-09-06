import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { basename, resolve } from 'node:path';
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

function successfulSpawn() {
  return scriptedSpawn(async (child, args) => {
    await writeSmokeResult(args);
    closeChild(child);
  });
}

test('initial evidence failure does not launch and records a non-passing attempt', async (t) => {
  const fixture = await smokeFixture(t);
  let launches = 0;
  const io = {
    ...fs,
    writeFile: async (path, data) => {
      if (basename(path) === 'native-smoke-stdout.txt') throw new Error('disk full');
      return fs.writeFile(path, data);
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(
      smokeArgs(fixture),
      () => {
        launches += 1;
      },
      { io, tempBase: fixture.root },
    ),
  );
  assert.equal(launches, 0);
  assert.equal(error.manifest.failure.kind, 'evidence');
  assert.equal(error.manifest.cleanup, 'not-created');
  assert.equal(
    JSON.parse(await fs.readFile(resolve(error.evidenceDirectory, 'manifest.json'), 'utf8'))
      .outcome,
    'failure',
  );
});

test('failed raw preservation retains the profile and keeps the original process failure', async (t) => {
  const fixture = await smokeFixture(t);
  const io = {
    ...fs,
    writeFile: async (path, data) => {
      if (basename(path) === 'native-smoke-result.json') throw new Error('cannot preserve');
      return fs.writeFile(path, data);
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(
      smokeArgs(fixture),
      scriptedSpawn(async (child, args) => {
        await writeSmokeResult(args, { windowVisible: false });
        closeChild(child, 1);
      }),
      { io, tempBase: fixture.root },
    ),
  );
  assert.equal(error.manifest.failure.kind, 'exit');
  assert.match(error.manifest.validationFailure, /window did not become visible/);
  assert.equal(error.manifest.cleanup, 'retained');
  assert.equal(error.manifest.evidenceErrors.length, 1);
  assert.ok((await fs.stat(error.manifest.profileRoot)).isDirectory());
  assert.ok(
    (await fs.readFile(resolve(error.manifest.profileRoot, 'native-smoke-result.json'))).length > 0,
  );
});

test('cleanup failure never hides the original validation failure or claims an intact retained root', async (t) => {
  const fixture = await smokeFixture(t);
  const io = {
    ...fs,
    rm: async () => {
      throw new Error('partly removed then failed');
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(
      smokeArgs(fixture),
      scriptedSpawn(async (child, args) => {
        await writeSmokeResult(args, { windowVisible: false });
        closeChild(child);
      }),
      { io, tempBase: fixture.root },
    ),
  );
  assert.equal(error.manifest.failure.kind, 'validation');
  assert.equal(error.manifest.cleanup, 'failed-may-be-partial');
  assert.match(error.manifest.cleanupError, /partly removed/);
  assert.ok(
    (await fs.readFile(resolve(error.evidenceDirectory, 'native-smoke-result.json'))).length > 0,
  );
});

test('a late failure writing a complete success draft leaves the published manifest non-passing', async (t) => {
  const fixture = await smokeFixture(t);
  const io = {
    ...fs,
    writeFile: async (path, data) => {
      await fs.writeFile(path, data);
      if (basename(path) === 'manifest.pending.json' && JSON.parse(data).outcome === 'success') {
        throw new Error('late write failure');
      }
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(smokeArgs(fixture), successfulSpawn(), { io, tempBase: fixture.root }),
  );
  assert.equal(error.manifest.failure.kind, 'evidence');
  const published = JSON.parse(
    await fs.readFile(resolve(error.evidenceDirectory, 'manifest.json'), 'utf8'),
  );
  assert.equal(published.outcome, 'finalizing');
  assert.equal(error.manifest.outcome, 'failure');
});

test('validates the exact captured raw bytes even if their source changes after capture', async (t) => {
  const fixture = await smokeFixture(t);
  let sourcePath;
  const io = {
    ...fs,
    readFile: async (path, ...args) => {
      const raw = await fs.readFile(path, ...args);
      if (path === sourcePath) await fs.writeFile(sourcePath, 'changed after capture');
      return raw;
    },
  };
  const result = await runNativeSmoke(
    smokeArgs(fixture),
    scriptedSpawn(async (child, args) => {
      sourcePath = smokePaths(args).result;
      await writeSmokeResult(args);
      closeChild(child);
    }),
    { io, tempBase: fixture.root },
  );
  assert.equal(result.manifest.outcome, 'success');
  assert.equal(
    JSON.parse(
      await fs.readFile(resolve(result.evidenceDirectory, 'native-smoke-result.json'), 'utf8'),
    ).ok,
    true,
  );
});

test('does not recursively remove a profile whose resolved parent changed', async (t) => {
  const fixture = await smokeFixture(t);
  let removes = 0;
  let rootLookups = 0;
  const io = {
    ...fs,
    realpath: async (path) => {
      if (basename(path).startsWith('kerfdesk-native-smoke-')) {
        rootLookups += 1;
        if (rootLookups === 2) return resolve(fixture.root, 'outside', 'profile');
      }
      return fs.realpath(path);
    },
    rm: async () => {
      removes += 1;
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(smokeArgs(fixture), successfulSpawn(), { io, tempBase: fixture.root }),
  );
  assert.equal(removes, 0);
  assert.equal(error.manifest.failure.kind, 'cleanup');
  assert.equal(error.manifest.cleanup, 'failed-may-be-partial');
});

test('an unreadable raw result retains the created profile rather than destroying the only evidence', async (t) => {
  const fixture = await smokeFixture(t);
  const io = {
    ...fs,
    readFile: async (path, ...args) => {
      if (basename(path) === 'native-smoke-result.json') {
        throw Object.assign(new Error('access denied'), { code: 'EACCES' });
      }
      return fs.readFile(path, ...args);
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(smokeArgs(fixture), successfulSpawn(), { io, tempBase: fixture.root }),
  );
  assert.equal(error.manifest.failure.kind, 'result');
  assert.equal(error.manifest.rawResult, 'unreadable');
  assert.equal(error.manifest.cleanup, 'retained');
  assert.equal(error.manifest.evidenceErrors.length, 1);
  assert.ok((await fs.stat(error.manifest.profileRoot)).isDirectory());
});

test('validation remains primary when saving its logs fails', async (t) => {
  const fixture = await smokeFixture(t);
  const io = {
    ...fs,
    writeFile: async (path, data) => {
      if (basename(path) === 'native-smoke-stdout.txt' && data !== '') {
        throw new Error('stdout evidence unavailable');
      }
      return fs.writeFile(path, data);
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(
      smokeArgs(fixture),
      scriptedSpawn(async (child, args) => {
        await writeSmokeResult(args, { windowVisible: false });
        child.stdout.write('window log');
        closeChild(child);
      }),
      { io, tempBase: fixture.root },
    ),
  );
  assert.equal(error.manifest.failure.kind, 'validation');
  assert.match(error.manifest.failure.message, /window did not become visible/);
  assert.equal(error.manifest.evidenceErrors.length, 1);
  assert.equal(error.manifest.cleanup, 'retained');
});

test('refuses to delete a different same-prefix sibling returned after initial ownership binding', async (t) => {
  const fixture = await smokeFixture(t);
  const sibling = resolve(fixture.root, 'kerfdesk-native-smoke-sibling');
  await fs.mkdir(sibling);
  let rootLookups = 0;
  let removePath = null;
  const io = {
    ...fs,
    realpath: async (path) => {
      if (basename(path).startsWith('kerfdesk-native-smoke-')) {
        rootLookups += 1;
        if (rootLookups === 2) return fs.realpath(sibling);
      }
      return fs.realpath(path);
    },
    rm: async (path) => {
      removePath = path;
    },
  };
  const error = await failedSmoke(
    runNativeSmoke(smokeArgs(fixture), successfulSpawn(), { io, tempBase: fixture.root }),
  );
  assert.equal(removePath, null);
  assert.equal(error.manifest.failure.kind, 'cleanup');
  assert.equal(error.manifest.cleanup, 'failed-may-be-partial');
  assert.ok((await fs.stat(sibling)).isDirectory());
});
