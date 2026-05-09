/**
 * T3-41 source-level guard: every E2E fixture test must pair its snapshot or
 * perf assertion with parsed semantic G-code checks.
 *
 * Run: npx tsx tests/e2e-semantic-assertions.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e2eDir = path.join(root, 'tests', 'e2e');

test('every tests/e2e/*.test.ts file calls assertSemanticGcode', () => {
  const testFiles = fs.readdirSync(e2eDir)
    .filter(file => file.endsWith('.test.ts'))
    .sort();
  assert.ok(testFiles.length > 0, 'found E2E test files');

  const missing = testFiles.filter(file => {
    const source = fs.readFileSync(path.join(e2eDir, file), 'utf-8');
    return !/\bassertSemanticGcode\s*\(/.test(source);
  });

  assert.deepEqual(missing, []);
});

test('shared E2E semantic helper uses the parser and burn-bounds analyzer', () => {
  const helper = fs.readFileSync(path.join(e2eDir, 'helpers', 'semanticGcodeAssertions.ts'), 'utf-8');
  assert.match(helper, /parseGcode/);
  assert.match(helper, /analyzeBurnBounds/);
  assert.match(helper, /noBurnDuringRapid/);
  assert.match(helper, /spindleNeverExceedsMax/);
});
