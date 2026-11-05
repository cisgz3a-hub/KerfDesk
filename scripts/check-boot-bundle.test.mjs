// The boot-bundle guard (S9-P3-2) must find what the first visit downloads and
// fail on growth, on an unrecorded shrink, and on a worker-only library there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootBundleProblems, bootClosure } from './check-boot-bundle.mjs';

const chunk = (name, imports = [], dynamicImports = [], packages = []) => ({
  name,
  isEntry: false,
  imports,
  dynamicImports,
  packages,
});

const CHUNKS = {
  'assets/browser-entry.js': chunk(
    'browser-entry',
    ['assets/preload-helper.js'],
    ['assets/main.js', 'assets/mobile.js'],
  ),
  'assets/preload-helper.js': chunk('preload-helper'),
  'assets/main.js': chunk('main', ['assets/io.js', 'assets/core.js'], ['assets/tiff.js']),
  'assets/io.js': chunk('io', ['assets/core.js']),
  'assets/core.js': chunk('core'),
  'assets/mobile.js': chunk('mobile'),
  'assets/tiff.js': chunk('tiff-page', [], [], ['fflate', 'tiff']),
};

test('the boot closure is the entry, its imports and the main chunk with its imports', () => {
  assert.deepEqual(bootClosure(CHUNKS, ['assets/browser-entry.js']), [
    'assets/browser-entry.js',
    'assets/core.js',
    'assets/io.js',
    'assets/main.js',
    'assets/preload-helper.js',
  ]);
});

test('passes within 2 % of the baseline', () => {
  const measured = { gzipBytes: 1_015_000, packagesByFile: { 'assets/io.js': ['zod'] } };
  assert.deepEqual(bootBundleProblems(measured, { gzipBytes: 1_000_000 }), []);
});

test('fails on more than 2 % growth', () => {
  const problems = bootBundleProblems(
    { gzipBytes: 1_021_000, packagesByFile: {} },
    {
      gzipBytes: 1_000_000,
    },
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /over/);
});

test('fails until a 2 % shrink is recorded in the baseline', () => {
  const problems = bootBundleProblems(
    { gzipBytes: 970_000, packagesByFile: {} },
    {
      gzipBytes: 1_000_000,
    },
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /lower/);
});

test('fails when a worker-only library is downloaded at boot', () => {
  const problems = bootBundleProblems(
    { gzipBytes: 1_000_000, packagesByFile: { 'assets/io.js': ['linkedom', 'saxes', 'zod'] } },
    { gzipBytes: 1_000_000 },
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /linkedom/);
  assert.match(problems[1], /saxes/);
});
