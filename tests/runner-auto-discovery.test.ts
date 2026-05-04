/**
 * T2-22 (Stage 1): the test runner auto-discovers `*.test.ts(x)` files
 * in `tests/`. Replaces T1-47's runner-registration-coverage guard,
 * which is now obsolete by construction — auto-discovery means no test
 * file can be silently skipped because there's no manual list to
 * forget to update.
 *
 * This test pins the auto-discovery shape in `scripts/run-tests.mjs`
 * (no manual files array; readdirSync walk; EXCLUDED_DIRS sentinel).
 * If a future change reverts to a manual list, this test fires.
 *
 * Run: npx tsx tests/runner-auto-discovery.test.ts
 */
import { readFileSync, readdirSync, accessSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-22 runner auto-discovery ===\n');

const ROOT = process.cwd();
const RUNNER_PATH = resolve(ROOT, 'scripts/run-tests.mjs');
const TESTS_DIR = resolve(ROOT, 'tests');

const runnerSrc = readFileSync(RUNNER_PATH, 'utf-8');

// 1. T2-22 marker present
assert(/T2-22/.test(runnerSrc), 'T2-22 marker present in run-tests.mjs');

// 2. readdirSync walk infrastructure present
assert(/readdirSync/.test(runnerSrc),
  'auto-discovery uses readdirSync (filesystem walk)');
assert(/function walkTests/.test(runnerSrc),
  'walkTests recursive helper declared');

// 3. Excluded directories sentinel present (snapshots / helpers / fixtures / node_modules)
{
  const exclMatch = runnerSrc.match(/EXCLUDED_DIRS\s*=\s*new Set\(\[([^\]]+)\]/);
  assert(exclMatch != null, 'EXCLUDED_DIRS Set declared');
  if (exclMatch) {
    const body = exclMatch[1];
    assert(/snapshots/.test(body), 'EXCLUDED_DIRS includes snapshots');
    assert(/helpers/.test(body), 'EXCLUDED_DIRS includes helpers');
    assert(/fixtures/.test(body), 'EXCLUDED_DIRS includes fixtures');
    assert(/node_modules/.test(body), 'EXCLUDED_DIRS includes node_modules');
  }
}

// 4. Test file pattern matches both .ts and .tsx
{
  const patternMatch = runnerSrc.match(/TEST_FILE_PATTERN\s*=\s*\/([^/]+)\//);
  assert(patternMatch != null, 'TEST_FILE_PATTERN regex declared');
  if (patternMatch) {
    const re = new RegExp(patternMatch[1]);
    assert(re.test('foo.test.ts'), 'pattern matches .test.ts');
    assert(re.test('foo.test.tsx'), 'pattern matches .test.tsx');
    assert(!re.test('foo.helpers.ts'), 'pattern does NOT match .helpers.ts');
    assert(!re.test('foo.ts'), 'pattern does NOT match plain .ts');
  }
}

// 5. The OLD manual `const files = [...]` array is gone
assert(
  !/const files = \[\s*\n[^]*?'deterministic-ids\.test\.ts'/.test(runnerSrc),
  'OLD manual `const files = [...]` literal-array list removed (no longer hardcodes individual filenames)',
);

// 6. files comes from walkTests result, sorted
assert(/walkTests\(testsDir\)\.sort\(\)/.test(runnerSrc),
  'files list = walkTests(testsDir).sort() (deterministic order)');

// 6a. KNOWN_FAILURES skip mechanism present + visible
assert(/KNOWN_FAILURES = new Map/.test(runnerSrc),
  'KNOWN_FAILURES skip-list Map declared');
assert(/console\.error\([^)]*↷ \$\{f\} \(skipped: \$\{skipReason\}\)/.test(runnerSrc),
  'skip is logged to stderr with `↷` marker so CI surfaces it');
assert(/T2-22-followup/.test(runnerSrc),
  'each KNOWN_FAILURES entry cites a follow-up ticket (T2-22-followup grep matches)');

// 7. Sanity: discovery produces > 100 files (the suite is large)
//    This catches "the walk is broken / returns nothing" without us having
//    to count every test by hand.
{
  const TEST_FILE_PATTERN = /\.test\.tsx?$/;
  const EXCLUDED_DIRS = new Set(['snapshots', 'helpers', 'fixtures', 'node_modules']);
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(resolve(dir, entry.name), out);
      } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        out.push(entry.name);
      }
    }
    return out;
  }
  const found = walk(TESTS_DIR);
  assert(found.length > 100,
    `auto-discovery walk finds > 100 test files (got ${found.length}; sanity check)`);
}

// 8. The retired T1-47 file (runner-registration-coverage.test.ts) is gone.
//    Auto-discovery makes its failure mode impossible by construction.
{
  let exists = false;
  try {
    accessSync(resolve(TESTS_DIR, 'runner-registration-coverage.test.ts'));
    exists = true;
  } catch {
    exists = false;
  }
  assert(!exists,
    'tests/runner-registration-coverage.test.ts removed (T1-47 retired, superseded by T2-22 auto-discovery)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
