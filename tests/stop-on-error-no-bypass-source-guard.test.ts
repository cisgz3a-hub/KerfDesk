/**
 * T1-116: source-level CI guard. The fix removes the casual "Stop job
 * on GRBL errors" checkbox + drops the production passthrough in
 * `useAppDeviceProfiles`, but a future refactor could quietly add a
 * new code path that calls `setStopOnError(false, ...)` without going
 * through `createStopOnErrorOverrideToken(reason)`. This test scans
 * the production source tree (src/) and fails if it finds any
 * `setStopOnError(false ...)` call site outside the approved
 * locations: the controller's own definition + tests.
 *
 * If you legitimately need a new diagnostics-mode override surface,
 * mint the token explicitly:
 *
 *   import { createStopOnErrorOverrideToken } from '...';
 *   controller.setStopOnError(false, createStopOnErrorOverrideToken('your reason'));
 *
 * The source-level scan ignores false-value calls that already include
 * the factory call in the same statement.
 *
 * Run: npx tsx tests/stop-on-error-no-bypass-source-guard.test.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcRoot = resolve(repoRoot, 'src');

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walkTs(full);
    } else if (s.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      yield full;
    }
  }
}

console.log('\n=== T1-116 source-level guard: no production setStopOnError(false) ===\n');

const violations: Array<{ file: string; line: number; text: string }> = [];

// Files that legitimately reference setStopOnError(false) — the
// controller's own definition (which throws on missing token) and any
// developer-mode override surface that explicitly mints a token in
// the SAME statement. Anything else in `src/` is a regression.
const allowedFiles = new Set<string>([
  // The controller's own definition of setStopOnError.
  resolve(srcRoot, 'controllers', 'grbl', 'GrblController.ts'),
  // T1-163 (audit F-001): the token's definition module. Its JSDoc
  // mentions `setStopOnError(false)` literally when describing the
  // gate the token authorizes; those references are documentation,
  // not call sites. The scanner only strips `//` line comments, not
  // `/* ... */` block comments, so this sibling of GrblController.ts
  // is allowlisted alongside it.
  resolve(srcRoot, 'controllers', 'grbl', 'StopOnErrorOverrideToken.ts'),
]);

for (const file of walkTs(srcRoot)) {
  // The .d.ts type-only declarations don't count as live code paths.
  if (file.endsWith('.d.ts')) continue;
  if (allowedFiles.has(file)) continue;

  const text = readFileSync(file, 'utf-8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match `setStopOnError(false ...)`. Ignore comments — strip
    // anything after a //. Multi-line block comments are rare here;
    // the false-call is short and lives on one line.
    const stripped = line.replace(/\/\/.*$/, '');
    if (!/setStopOnError\s*\(\s*false/.test(stripped)) continue;
    // Allowed pattern: the same statement contains
    // `createStopOnErrorOverrideToken` — the call is paired with a
    // freshly-minted token. (Multi-line statements are rare here; if
    // they appear in the future, extend this scan to look across
    // adjacent lines.)
    if (/createStopOnErrorOverrideToken/.test(stripped)) continue;
    violations.push({
      file: relative(repoRoot, file),
      line: i + 1,
      text: line.trim(),
    });
  }
}

assert(
  violations.length === 0,
  `no production caller of setStopOnError(false) without an inline createStopOnErrorOverrideToken (found ${violations.length} violation(s))`,
);

if (violations.length > 0) {
  console.error('\nViolations:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
}

// Sanity: verify the scanner detects the pattern when present. Build
// a synthetic line to make sure the regex matches what we expect.
{
  const synthetic = '  controller.setStopOnError(false);';
  const detected = /setStopOnError\s*\(\s*false/.test(synthetic);
  assert(detected, 'scanner regex matches a synthetic violation (sanity check)');

  const synthetic2 = '  controller.setStopOnError(false, createStopOnErrorOverrideToken("x"));';
  const stripped = synthetic2.replace(/\/\/.*$/, '');
  const wouldFlag = /setStopOnError\s*\(\s*false/.test(stripped)
    && !/createStopOnErrorOverrideToken/.test(stripped);
  assert(!wouldFlag, 'scanner skips synthetic call that includes createStopOnErrorOverrideToken inline');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
