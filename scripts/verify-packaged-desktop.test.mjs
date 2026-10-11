import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { desktopRuntimeGraph, packagedRuntimeProblems } from './desktop-runtime-graph.mjs';
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
  'public/desktop-release-manifest.mjs',
  'public/desktop-update-notes.mjs',
  'public/desktop-release-keys.json',
  'public/desktop-sandbox-contract.mjs',
  'public/licence-key-text.mjs',
  'node_modules/electron-updater/package.json',
];

test('follows nested runtime imports and public re-exports without admitting type or unrelated SDK packages', () => {
  const modules = new Map([
    [
      'electron/main.ts',
      "import { start } from './remote/desktop.js'; import type { Server } from './mcp/server.js'; import { type Schema } from '@modelcontextprotocol/server'; import 'node:fs'; import 'fs/promises'; import 'electron'; start();",
    ],
    [
      'electron/remote/desktop.ts',
      "import WebSocket from 'ws'; import { schema } from '../../public/schema.mjs'; export const start = () => [WebSocket, schema];",
    ],
    ['public/schema.mjs', "export { schema } from './validation.mjs';"],
    ['public/validation.mjs', "import { z } from 'zod'; export const schema = z.string();"],
    [
      'electron/mcp/server.ts',
      "import { Server } from '@modelcontextprotocol/server'; export { Server };",
    ],
    ['electron/unreachable.ts', "import 'react';"],
  ]);
  const graph = desktopRuntimeGraph({
    entry: 'electron/main.ts',
    source: true,
    readFile: (path) => modules.get(path) ?? null,
  });
  assert.deepEqual(graph.packages, ['ws', 'zod']);
  assert.ok(graph.files.includes('public/validation.mjs'));
  assert.ok(!graph.files.includes('electron/mcp/server.ts'));
  assert.ok(!graph.files.includes('electron/unreachable.ts'));
});

test('config and archive agreement cannot hide a missing nested eager runtime package', () => {
  const modules = new Map([
    ['dist-electron/main.js', "import './remote/desktop.js';"],
    ['dist-electron/remote/desktop.js', "import WebSocket from 'ws'; export default WebSocket;"],
    ['node_modules/electron-updater/package.json', '{"main":"index.js"}'],
    ['node_modules/electron-updater/index.js', 'module.exports = {};'],
  ]);
  const problems = packagedDesktopProblems({
    wire: '010011001',
    fuses: configuredFuses(STABLE),
    allowed: ['electron-updater'],
    entries: [...new Set([...ENTRIES, ...modules.keys()])],
    readFile: (path) => modules.get(path) ?? null,
  });
  assert.deepEqual(problems, ['app.asar is missing runtime package ws']);
});

test('requires the Node import entry point and mandatory dependency entry points inside the archive', () => {
  const modules = new Map([
    ['dist-electron/main.js', "import 'ws';"],
    [
      'node_modules/ws/package.json',
      JSON.stringify({
        exports: {
          '.': { browser: './browser.js', import: './wrapper.mjs', require: './index.js' },
        },
        dependencies: { mandatory: '1' },
        peerDependencies: { bufferutil: '^4' },
        peerDependenciesMeta: { bufferutil: { optional: true } },
      }),
    ],
    ['node_modules/ws/browser.js', ''],
    ['node_modules/ws/index.js', ''],
    ['node_modules/mandatory/package.json', '{"main":"lib/index.js"}'],
  ]);
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), [
    'app.asar is missing runtime entry node_modules/ws/wrapper.mjs',
    'app.asar is missing runtime entry node_modules/mandatory/lib/index.js',
  ]);
  modules.set('node_modules/ws/wrapper.mjs', '');
  modules.set('node_modules/mandatory/lib/index.js', '');
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), []);
});

test('rejects a missing nested local module even when the main entry is present', () => {
  const modules = new Map([['dist-electron/main.js', "import './remote/desktop.js';"]]);
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), [
    'Missing runtime module: dist-electron/remote/desktop.js',
  ]);
});

test('walks eager internal package files rather than trusting the selected entry alone', () => {
  const modules = new Map([
    ['dist-electron/main.js', "import 'ws';"],
    ['node_modules/ws/package.json', '{"exports":{".":{"import":"./wrapper.mjs"}}}'],
    [
      'node_modules/ws/wrapper.mjs',
      "import WebSocket from './lib/websocket.js'; export default WebSocket;",
    ],
  ]);
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), [
    'Missing runtime module: node_modules/ws/lib/websocket.js',
  ]);
  modules.set('node_modules/ws/lib/websocket.js', 'export default class WebSocket {}');
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), []);
});

test('distinguishes actual require conditions and only skips directly caught declared optional loads', () => {
  const modules = new Map([
    ['dist-electron/main.js', "const ws = require('ws');"],
    [
      'node_modules/ws/package.json',
      JSON.stringify({
        exports: { '.': { import: './missing-wrapper.mjs', require: './index.js' } },
        peerDependencies: { bufferutil: '^4' },
        peerDependenciesMeta: { bufferutil: { optional: true } },
      }),
    ],
    ['node_modules/ws/index.js', "module.exports = require('./lib/client');"],
    [
      'node_modules/ws/lib/client.js',
      "try { require('bufferutil'); } catch {} module.exports = {};",
    ],
  ]);
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), []);
  modules.set(
    'node_modules/ws/lib/client.js',
    "try { const deferred = () => require('bufferutil'); } catch {} module.exports = {};",
  );
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), [
    'app.asar is missing runtime package bufferutil',
  ]);
  modules.set(
    'node_modules/ws/lib/client.js',
    "try { require('undeclared'); } catch {} module.exports = {};",
  );
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), [
    'app.asar is missing runtime package undeclared',
  ]);
});

test('checks exact package subpaths and honours an explicit blocked Node export', () => {
  const modules = new Map([
    ['dist-electron/main.js', "import 'zod/v4';"],
    [
      'node_modules/zod/package.json',
      JSON.stringify({ exports: { './v4': { node: null, default: './v4/index.js' } } }),
    ],
    ['node_modules/zod/v4/index.js', 'export {};'],
  ]);
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), [
    'app.asar has no supported import entry for zod/v4',
  ]);
  modules.set(
    'node_modules/zod/package.json',
    '{"exports":{"./v4":{"types":"./missing.d.ts","import":"./v4/index.js"}}}',
  );
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), []);
});

test('honours debug optional peer metadata only for its caught colour adapter', () => {
  const modules = new Map([
    ['dist-electron/main.js', "import 'debug';"],
    [
      'node_modules/debug/package.json',
      '{"main":"index.js","peerDependenciesMeta":{"supports-color":{"optional":true}}}',
    ],
    [
      'node_modules/debug/index.js',
      "try { require('supports-color'); } catch {} module.exports = {};",
    ],
  ]);
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), []);
  modules.set('node_modules/debug/package.json', '{"main":"index.js"}');
  assert.deepEqual(packagedRuntimeProblems({ readFile: (path) => modules.get(path) ?? null }), [
    'app.asar is missing runtime package supports-color',
  ]);
});

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

test('requires the packaged verifiers and trust anchors in every distribution config', () => {
  for (const required of [
    'public/desktop-release-manifest.mjs',
    'public/desktop-update-notes.mjs',
    'public/desktop-release-keys.json',
  ]) {
    assert.ok(STABLE.includes(`  - ${required}`));
    assert.ok(PREVIEW.includes(`  - ${required}`));
    assert.ok(readFileSync('electron-builder.sandbox.yml', 'utf8').includes(`  - ${required}`));
    const problems = packagedDesktopProblems({
      wire: '010011001',
      fuses: configuredFuses(STABLE),
      allowed: ['electron-updater'],
      entries: ENTRIES.filter((entry) => entry !== required),
    });
    assert.ok(problems.includes(`app.asar is missing ${required}`));
  }
});
