import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allowedNodeModules,
  asarEntries,
  configuredFuses,
  packagedDesktopProblems,
} from './verify-packaged-desktop.mjs';

const STABLE = readFileSync('electron-builder.yml', 'utf8');
const PREVIEW = readFileSync('electron-builder.preview.yml', 'utf8');
const ENTRIES = [
  'package.json',
  'dist-electron/main.js',
  'dist/web/index.html',
  'node_modules/electron-updater/package.json',
];

test('reads the fuses each builder config asks for', () => {
  const stable = configuredFuses(STABLE);
  assert.equal(stable.runAsNode, false);
  assert.equal(stable.enableCookieEncryption, true);
  assert.equal(stable.loadBrowserProcessSpecificV8Snapshot, false);
  assert.equal(configuredFuses(PREVIEW).enableCookieEncryption, false);
  assert.ok(allowedNodeModules(STABLE).includes('electron-updater'));
});

test('accepts a package whose fuses and contents match its config', () => {
  assert.deepEqual(
    packagedDesktopProblems({
      wire: '010011001',
      fuses: configuredFuses(STABLE),
      allowed: ['electron-updater'],
      entries: ENTRIES,
    }),
    [],
  );
});

test('names each fuse left at its Electron default', () => {
  const problems = packagedDesktopProblems({
    wire: '101100101',
    fuses: configuredFuses(STABLE),
    allowed: ['electron-updater'],
    entries: ENTRIES,
  });
  assert.ok(problems.includes('fuse runAsNode is 1, config wants 0'));
  assert.ok(problems.includes('fuse onlyLoadAppFromAsar is 0, config wants 1'));
});

test('refuses renderer packages, missing bundles and main-process source maps', () => {
  const problems = packagedDesktopProblems({
    wire: '010011001',
    fuses: configuredFuses(STABLE),
    allowed: ['electron-updater'],
    entries: [
      'package.json',
      'dist-electron/main.js',
      'dist-electron/main.js.map',
      'node_modules/electron-updater/package.json',
      'node_modules/@tabler/icons/package.json',
    ],
  });
  assert.ok(problems.some((problem) => problem.includes('@tabler/icons')));
  assert.ok(problems.includes('app.asar is missing dist/web/index.html'));
  assert.ok(problems.some((problem) => problem.includes('main.js.map')));
});

test('lists nested asar entries as paths', () => {
  const header = {
    files: {
      'package.json': { size: 1 },
      node_modules: { files: { ms: { files: { 'index.js': { size: 1 } } } } },
    },
  };
  assert.deepEqual(asarEntries(header), ['package.json', 'node_modules/ms/index.js']);
});
