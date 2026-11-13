/* global process -- Node test runner; the lint config gives node globals to scripts/ only. */
// ADR-712: the Electron download cache must name the folders @electron/get and
// electron-builder really use, and every job that installs or packages must
// restore it first.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSON_SCHEMA, load } from 'js-yaml';

import {
  cacheFolders,
  cachePlan,
  checksumFromShasums,
  isRetryableStatus,
  KEY_PREFIX,
  lockedVersion,
  releaseCacheDirectory,
} from './electron-downloads.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const ACTION = './.github/actions/electron-downloads';
const GUARD = "hashFiles('.github/actions/electron-downloads/action.yml') != ''";

/** The real folder of a dependency pnpm linked next to an unscoped package. */
function sibling(fromPackageDir, name) {
  return realpathSync(join(realpathSync(fromPackageDir), '..', name));
}

async function electronGetCache(electronGetDir) {
  const file = ['dist/Cache.js', 'dist/esm/Cache.js']
    .map((candidate) => join(electronGetDir, candidate))
    .find((candidate) => existsSync(candidate));
  assert.ok(file, `no Cache.js in ${electronGetDir}`);
  return (await import(pathToFileURL(file).href)).Cache;
}

test('reads the one locked Electron and electron-builder version', () => {
  assert.equal(lockedVersion(lock, 'electron'), pkg.devDependencies.electron);
  assert.equal(lockedVersion(lock, 'electron-builder'), pkg.devDependencies['electron-builder']);
  assert.throws(() => lockedVersion('packages:\n', 'electron'), /exactly one electron version/u);
  assert.throws(
    () => lockedVersion('  electron@1.0.0:\n  electron@2.0.0:\n', 'electron'),
    /found 1\.0\.0, 2\.0\.0/u,
  );
});

test("names both @electron/get copies' default cache folder and release subfolder", async () => {
  const version = lockedVersion(lock, 'electron');
  const zip = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const folders = cacheFolders({ platform: process.platform, env: process.env, home: homedir() });
  const builderLib = sibling(join(root, 'node_modules', 'electron-builder'), 'app-builder-lib');
  const copies = [
    sibling(join(root, 'node_modules', 'electron'), '@electron/get'), // electron's postinstall
    sibling(builderLib, '@electron/get'), // electron-builder's Electron zip
  ];
  for (const copy of copies) {
    const Cache = await electronGetCache(copy);
    assert.equal(new Cache().cacheRoot, folders.electron, copy);
    const url = `https://github.com/electron/electron/releases/download/v${version}/${zip}`;
    assert.equal(Cache.getCacheDirectory(url), releaseCacheDirectory(version), copy);
  }
  const { getCacheDirectory } = createRequire(join(builderLib, 'package.json'))(
    './out/util/electronGet.js',
  );
  assert.equal(getCacheDirectory({ allowEnvVarOverride: true }), folders.builder);
});

test('maps each runner OS to its cache folders', () => {
  assert.deepEqual(cacheFolders({ platform: 'linux', env: {}, home: '/home/runner' }), {
    electron: join('/home/runner', '.cache', 'electron'),
    builder: join('/home/runner', '.cache', 'electron-builder'),
  });
  assert.deepEqual(cacheFolders({ platform: 'darwin', env: {}, home: '/Users/runner' }), {
    electron: join('/Users/runner', 'Library', 'Caches', 'electron'),
    builder: join('/Users/runner', 'Library', 'Caches', 'electron-builder'),
  });
  const local = 'C:\\Users\\runneradmin\\AppData\\Local';
  assert.deepEqual(
    cacheFolders({ platform: 'win32', env: { LOCALAPPDATA: local }, home: 'C:\\x' }),
    {
      electron: join(local, 'electron', 'Cache'),
      builder: join(local, 'electron-builder', 'Cache'),
    },
  );
});

test('packaging jobs save per job; installing jobs restore the same folders and never save', () => {
  const folders = { electron: '/c/electron', builder: '/c/electron-builder' };
  const base = { arch: 'x64', electronVersion: '44.9.1', builderVersion: '26.17.0', folders };
  const shared = `${KEY_PREFIX}-linux-x64-electron-44.9.1-builder-26.17.0-`;
  const packaging = cachePlan({
    ...base,
    platform: 'linux',
    packaging: true,
    job: 'linux-package',
  });
  const installing = cachePlan({ ...base, platform: 'linux', packaging: false, job: 'unit-tests' });
  assert.equal(packaging.key, `${shared}linux-package`);
  assert.deepEqual(packaging.restoreKeys, [shared]);
  assert.deepEqual(installing.restoreKeys, [shared]);
  assert.ok(!installing.key.endsWith('linux-package'));
  // actions/cache versions an entry by its path list: restoring needs the same one.
  assert.deepEqual(installing.paths, packaging.paths);
  assert.deepEqual(packaging.paths, [folders.electron, folders.builder]);
  const mac = cachePlan({ ...base, platform: 'darwin', packaging: true, job: 'macos-package' });
  assert.equal(mac.paths.at(-1), `!${join(folders.builder, '*.keychain')}`);
});

test('parses SHASUMS256.txt and retries only transient HTTP answers', () => {
  const sum = 'a'.repeat(64);
  const text = `${'b'.repeat(64)} *electron-v1.0.0-linux-arm64.zip\n${sum} *electron-v1.0.0-linux-x64.zip\n`;
  assert.equal(checksumFromShasums(text, 'electron-v1.0.0-linux-x64.zip'), sum);
  assert.throws(() => checksumFromShasums(text, 'electron-v1.0.0-win32-x64.zip'), /no entry/u);
  for (const status of [408, 429, 500, 502, 503, 504]) assert.ok(isRetryableStatus(status), status);
  for (const status of [400, 403, 404]) assert.ok(!isRetryableStatus(status), status);
});

function workflowJobs() {
  const directory = join(root, '.github', 'workflows');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.yml'))
    .flatMap((name) => {
      const workflow = load(readFileSync(join(directory, name), 'utf8'), { schema: JSON_SCHEMA });
      return Object.entries(workflow.jobs ?? {}).map(([id, job]) => ({ name, id, job }));
    });
}

test('every installing or packaging job restores the Electron downloads first', () => {
  let packagingJobs = 0;
  for (const { name, id, job } of workflowJobs()) {
    const steps = job.steps ?? [];
    const install = steps.findIndex(
      (step) => step.run?.trim() === 'pnpm install --frozen-lockfile',
    );
    if (install < 0) continue;
    const label = `${name} ${id}`;
    const packaging = steps.some((step) =>
      /\bexec electron-builder\b|build-commercial-platform\.sh/u.test(step.run ?? ''),
    );
    const caches = steps.some(
      (step) =>
        step.with?.cache === 'pnpm' || step.uses === './.github/actions/setup-remote-control',
    );
    const index = steps.findIndex((step) => step.uses === ACTION);
    if (!packaging && !caches) {
      assert.equal(index, -1, `${label} restores no caches, so it needs no Electron cache`);
      continue;
    }
    assert.ok(index >= 0 && index < install, `${label} must use ${ACTION} before pnpm install`);
    const step = steps[index];
    assert.equal(step.with?.packaging === 'true', packaging, `${label} packaging input`);
    assert.equal(step.with?.cache === 'false', !caches, `${label} follows the job's cache policy`);
    const installIf = steps[install].if;
    if (installIf !== undefined) {
      const bare = String(installIf).replace(/^\$\{\{\s*|\s*\}\}$/gu, '');
      assert.ok(String(step.if).includes(bare), `${label} runs only when pnpm install runs`);
    }
    const checkout = steps.find((candidate) => candidate.uses?.startsWith('actions/checkout@'));
    if (checkout?.with?.ref !== undefined) {
      assert.ok(String(step.if).includes(GUARD), `${label} checks out a pinned commit`);
    }
    if (packaging) packagingJobs += 1;
  }
  assert.ok(packagingJobs >= 10, `found only ${packagingJobs} packaging jobs`);
});
