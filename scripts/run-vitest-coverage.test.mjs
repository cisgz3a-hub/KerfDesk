import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

test('the patched brace-expansion line reaches glob through a compatible minimatch edge', async () => {
  const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');

  assert.match(workspace, /brace-expansion@<5\.0\.8: 5\.0\.8/);
  assert.match(workspace, /['"]glob@10\.5\.0>minimatch['"]: 10\.2\.5/);
});
