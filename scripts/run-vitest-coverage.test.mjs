import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL('../', import.meta.url));

test('coverage runner records totals without turning perceptual timing into a coverage gate', async () => {
  const source = await readFile(new URL('./run-vitest-coverage.mjs', import.meta.url), 'utf8');

  assert.match(source, /KERFDESK_COVERAGE: '1'/);
  assert.match(source, /--coverage\.reporter=json-summary/);
  assert.match(source, /--coverage\.reporter=html/);
  assert.match(source, /--exclude=src\/__fixtures__\/perceptual\/\*\*/);
  assert.match(source, /--exclude=src\/core\/cnc\/vcarve-floor-depth\.test\.ts/);
  assert.match(source, /--exclude=src\/core\/cnc\/vcarve-thin-perceptual\.test\.ts/);
  assert.match(
    source,
    /--exclude=src\/platform\/electron\/release-desktop-preview-shell\.test\.ts/,
  );
  assert.doesNotMatch(source, /coverage\.threshold|--coverage\.threshold/);
});

test('the installed coverage provider includes brace patterns and uncovered source files', async () => {
  // Keep the fixture under the repository so its imports resolve the installed
  // Vitest/provider pair, without depending on their private dependency graph.
  const fixture = await mkdtemp(path.join(repository, '.coverage-braces-'));
  try {
    await writeFile(path.join(fixture, 'first.ts'), 'export const first = () => 1;\n');
    await writeFile(path.join(fixture, 'second.ts'), 'export const second = () => 2;\n');
    await writeFile(
      path.join(fixture, 'probe.test.ts'),
      "import { expect, test } from 'vitest';\n" +
        "import { first } from './first';\n" +
        "test('covered source', () => expect(first()).toBe(1));\n",
    );
    const config = path.join(fixture, 'vitest.config.mjs');
    await writeFile(
      config,
      "export default { test: { environment: 'node', maxWorkers: 1, " +
        "coverage: { provider: 'v8', include: ['{first,second}.ts'], " +
        "reporter: ['json-summary'] } } };\n",
    );
    const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const result = spawnSync(process.execPath, [vitest, 'run', '--config', config, '--coverage'], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    const summary = JSON.parse(
      await readFile(path.join(fixture, 'coverage', 'coverage-summary.json'), 'utf8'),
    );
    const files = Object.entries(summary).filter(([name]) => name !== 'total');
    assert.deepEqual(files.map(([name]) => path.basename(name)).sort(), ['first.ts', 'second.ts']);
    assert.equal(
      files.find(([name]) => path.basename(name) === 'first.ts')[1].functions.covered,
      1,
    );
    assert.equal(
      files.find(([name]) => path.basename(name) === 'second.ts')[1].functions.covered,
      0,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('the installed ESLint CLI enumerates brace patterns without a dependency API error', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'kerfdesk-eslint-braces-'));
  try {
    const config = path.join(fixture, 'eslint.config.mjs');
    await writeFile(config, "export default [{ files: ['**/*.js'], rules: {} }];\n");
    await writeFile(path.join(fixture, 'first.js'), 'console.log(1);\n');
    await writeFile(path.join(fixture, 'second.js'), 'console.log(2);\n');
    const eslint = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin/eslint.js');
    const result = spawnSync(
      process.execPath,
      [eslint, '--no-config-lookup', '--config', config, '--format', 'json', '{first,second}.js'],
      { cwd: fixture, encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    const files = JSON.parse(result.stdout);
    assert.deepEqual(files.map((file) => path.basename(file.filePath)).sort(), [
      'first.js',
      'second.js',
    ]);
    assert.ok(files.every((file) => file.errorCount === 0));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
