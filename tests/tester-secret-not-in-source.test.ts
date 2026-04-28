/**
 * T1-77 regression test: the legacy DEFAULT_TESTER_HMAC_SECRET literal must
 * NOT appear anywhere in the client-bundled `src/` tree.
 *
 * Bug: the literal `'bf5c9e2a-7d41-4c8e-9a1b-laserforge-tester-hmac-v1'` lived
 * in `src/entitlements/testerKey.ts` and was therefore present in every Vite
 * build. Anyone could grep the bundle and extract it.
 *
 * Fix: the literal was removed from source. Tests synthesize tester codes via
 * `__setTesterHmacSecretForTest`, not via the legacy default.
 *
 * This test is a source-level version of the bundle-search test. The
 * bundle search lives in scripts/verify-production-build.mjs (T1-81 +
 * T3-82) and runs against the actual Vite build output during `npm run
 * build`. Here we walk `src/` directly. If the literal isn't in source,
 * it can't be in the bundle Vite produces.
 *
 * Note: scripts/ and tests/ are intentionally NOT scanned. Those directories
 * never ship in the client bundle. scripts/generate-tester-key.mjs also no
 * longer carries the literal as of T1-77, but if a future change adds a
 * different secret there, that's not a bundle-leakage problem and is out of
 * this test's scope.
 *
 * Run: npx tsx tests/tester-secret-not-in-source.test.ts
 */
export {};

import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_DIR = join(REPO_ROOT, 'src');

const LEGACY_LITERAL = 'bf5c9e2a-7d41-4c8e-9a1b-laserforge-tester-hmac-v1';

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

function walkSourceFiles(dir: string, out: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkSourceFiles(full, out);
      continue;
    }
    if (
      entry.endsWith('.ts')
      || entry.endsWith('.tsx')
      || entry.endsWith('.js')
      || entry.endsWith('.jsx')
      || entry.endsWith('.mjs')
      || entry.endsWith('.json')
    ) {
      out.push(full);
    }
  }
}

void (() => {
  console.log('\n=== tester secret not in src/ (T1-77) ===\n');

  const files: string[] = [];
  walkSourceFiles(SRC_DIR, files);
  assert(files.length > 0, `walked src/ — found ${files.length} files to scan`);

  const matches: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (content.includes(LEGACY_LITERAL)) {
      matches.push(file);
    }
  }

  if (matches.length > 0) {
    console.error('  ✗ Legacy DEFAULT_TESTER_HMAC_SECRET literal found in:');
    for (const m of matches) {
      console.error('      -', m.replace(REPO_ROOT, '.'));
    }
  }
  assert(
    matches.length === 0,
    `legacy literal must not appear in src/ (found in ${matches.length} files)`,
  );

  // Defensive secondary check: some tools fold long strings across lines.
  // Walk again and verify the literal as a substring search of the joined
  // single-line normalized content. Same set of files, just a sanity pass
  // to catch line-wrap edge cases that a substring search of raw bytes
  // wouldn't notice.
  const normalizedMatches: string[] = [];
  for (const file of files) {
    const normalized = readFileSync(file, 'utf8').replace(/\s+/g, '');
    if (normalized.includes(LEGACY_LITERAL.replace(/\s+/g, ''))) {
      normalizedMatches.push(file);
    }
  }
  assert(
    normalizedMatches.length === 0,
    `legacy literal must not appear in src/ even with whitespace stripped (${normalizedMatches.length} files)`,
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
