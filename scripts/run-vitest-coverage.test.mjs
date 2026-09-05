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

test('the installed coverage glob expands braces through its actual dependency closure', () => {
  const coverageRequire = createRequire(require.resolve('@vitest/coverage-v8'));
  const excludeRequire = createRequire(coverageRequire.resolve('test-exclude'));
  const { globSync } = excludeRequire('glob');
  const found = globSync('src/ui/image-editor/editor-session{,-fill}.ts', { cwd: repository });
  assert.deepEqual(found.map((file) => file.replaceAll('\\', '/')).sort(), [
    'src/ui/image-editor/editor-session-fill.ts',
    'src/ui/image-editor/editor-session.ts',
  ]);
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
