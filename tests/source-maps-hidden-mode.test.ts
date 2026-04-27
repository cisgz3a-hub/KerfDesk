/**
 * T2-105 regression test: renderer sourcemaps use Vite hidden mode.
 *
 * Hidden mode generates .map files for crash symbolication/archive tooling,
 * but omits sourceMappingURL references from JS/CSS runtime bundles. The
 * package.json build.files negation globs then exclude the .map files from
 * shipped installers.
 *
 * Run: npx tsx tests/source-maps-hidden-mode.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== source maps hidden mode (T2-105) ===\n');

const viteConfig = readFileSync(join(REPO_ROOT, 'vite.config.ts'), 'utf8');
const verifier = readFileSync(join(REPO_ROOT, 'scripts', 'verify-production-build.mjs'), 'utf8');
const packageJson = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
) as { build?: { files?: string[] } };

assert(
  /sourcemap:\s*['"]hidden['"]/.test(viteConfig),
  'vite.config.ts sets build.sourcemap to hidden',
);
assert(
  !/sourcemap:\s*true\b/.test(viteConfig),
  'vite.config.ts does NOT set build.sourcemap to true',
);
assert(
  /sourceMappingURL/.test(verifier),
  'production verifier checks sourceMappingURL references',
);
assert(
  !/source-map files must not appear|source map file present/.test(verifier),
  'production verifier no longer rejects .map file existence',
);
const files = packageJson.build?.files ?? [];
assert(
  files.includes('dist/**/*') && files.includes('!dist/**/*.map'),
  'package.json includes renderer dist maps then excludes them from packaging',
);
assert(
  files.indexOf('!dist/**/*.map') > files.indexOf('dist/**/*'),
  'renderer .map exclusion appears after renderer dist inclusion',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
