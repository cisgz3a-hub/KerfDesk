/**
 * T1-234: keep the ESLint cleanup intentional.
 *
 * The sweep removes stale no-explicit-any disable comments because the
 * repo does not enable that rule, and it renames the SVG <use> helper so
 * react-hooks/rules-of-hooks does not mistake a pure parser helper for a
 * React hook.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { test } from 'node:test';

const ignoredDirectories = new Set([
  '.claude',
  '.git',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
]);

const scannedExtensions = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && scannedExtensions.has(extname(entry.name))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

test('SvgParser use-element transform helper is not hook-shaped', () => {
  const src = readFileSync('src/import/svg/SvgParser.ts', 'utf8');

  assert.doesNotMatch(src, /\busePositionTransform\b/);
  assert.match(src, /\bpositionTransformForUseElement\b/);
  assert.match(
    src,
    /multiplyMatrix\(useTransform, positionTransformForUseElement\(useNode\)\)/,
  );
});

test('stale no-explicit-any eslint-disable directives are gone', () => {
  const offenders = walk('.').filter(file => {
    const src = readFileSync(file, 'utf8');
    return /eslint-disable-(?:next-)?line[^\n]*@typescript-eslint\/no-explicit-any/.test(src);
  });

  assert.deepEqual(offenders, []);
});
