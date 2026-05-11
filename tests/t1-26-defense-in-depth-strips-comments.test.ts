/**
 * T1-167 (audit F-024): the T1-26 defense-in-depth M5 check in
 * `BaseGCodeStrategy.generate` must strip GRBL comments before testing
 * `/\bM5\b/i` on the tail.
 *
 * Pre-T1-167: `/\bM5\b/i.test(tailNonEmpty.join('\n'))` ran against the
 * raw tail, so a user template ending `; remember to send M5` (or
 * `(M5 reminder)`) would falsely match and skip the defense-in-depth
 * append. The audit (docs/AUDIT-2026-05-11.md F-024) notes the strict
 * `FOOTER_MISSING_M5` validator at line 444 normally catches this, but
 * the T1-26 check is the LAST line of defense if that validator is
 * bypassed.
 *
 * Post-T1-167: the tail is run through
 *   .replace(/\([^)]*\)/g, '')   // strip parenthesized comments
 *   .replace(/;.*$/, '')          // strip line comments
 * before the regex test, so only executable g-code tokens reach
 * `/\bM5\b/i`.
 *
 * The behavioral contract is exercised in
 * `tests/footer-m5-appended-at-send.test.ts` via a function that
 * mirrors the production algorithm byte-for-byte. THIS test source-
 * pins the actual production code in `src/core/output/Output.ts` so
 * a future edit that drifts the mirror cannot ship.
 *
 * Run: npx tsx tests/t1-26-defense-in-depth-strips-comments.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const outputSrc = readFileSync(resolve(here, '../src/core/output/Output.ts'), 'utf-8');

console.log('\n=== T1-167 T1-26 defense-in-depth strips comments before regex ===\n');

// -------- 1. T1-167 marker + audit cross-reference --------
{
  assert(/T1-167/.test(outputSrc), 'Output.ts carries T1-167 marker');
  assert(/audit F-024/.test(outputSrc), 'Output.ts cross-references audit F-024');
}

// -------- 2. The comment-strip replace chain is present --------
{
  // The fix is two replace chains: line-comments (`;` to EOL) and
  // parenthesized comments (`(...)`).
  assert(
    /\.replace\(\/\\\(\[\^\)\]\*\\\)\/g,\s*''\)/.test(outputSrc),
    'Output.ts strips `(...)` parenthesized comments from the tail',
  );
  assert(
    /\.replace\(\/;\.\*\$\/,\s*''\)/.test(outputSrc),
    'Output.ts strips `;` line-comments from the tail',
  );
}

// -------- 3. The regex test runs on the stripped tail, not the raw one --------
{
  // Pre-T1-167: `tailNonEmpty.join('\n')` was tested directly.
  // Post-T1-167: a new `tailCodeOnly` variable holds the stripped
  // tail and is what the regex runs on.
  assert(
    /tailCodeOnly\s*=/.test(outputSrc),
    'Output.ts declares the tailCodeOnly variable',
  );
  assert(
    /\/\\bM5\\b\/i\.test\(tailCodeOnly\)/.test(outputSrc),
    'Output.ts runs the M5 regex on tailCodeOnly (not the raw tail)',
  );
  // The old direct-on-tail pattern must be gone.
  assert(
    !/\/\\bM5\\b\/i\.test\(tailNonEmpty\.join\(['"]\\n['"]\)\)/.test(outputSrc),
    'Output.ts no longer runs the M5 regex on the raw `tailNonEmpty.join(...)`',
  );
}

// -------- 4. Algorithm contract: prove the strip works on the cited bug pattern --------
{
  // Replicate the production strip + regex inline to prove the
  // algorithm yields the correct answer on the audit's evidence cases.
  function defenseInDepthWouldFire(lines: string[]): boolean {
    const tailNonEmpty = lines.filter(l => l.trim().length > 0).slice(-5);
    const tailCodeOnly = tailNonEmpty
      .map(l => l.replace(/\([^)]*\)/g, '').replace(/;.*$/, ''))
      .join('\n');
    return !/\bM5\b/i.test(tailCodeOnly);
  }

  // Case from the audit: user template ends with "; remember to send M5"
  assert(
    defenseInDepthWouldFire(['G1 X10', 'M2 ; remember to send M5']),
    `audit evidence: "; remember to send M5" no longer counts as a real M5`,
  );
  // Parenthesized comment variant.
  assert(
    defenseInDepthWouldFire(['G1 X10', 'M2 (M5 reminder)']),
    `parenthesized comment "(M5 reminder)" no longer counts as a real M5`,
  );
  // Real M5 still suppresses (no double-append).
  assert(
    !defenseInDepthWouldFire(['G1 X10', 'M5 S0', 'M2']),
    'real M5 in tail still suppresses the defense-in-depth append',
  );
  // Mixed: real M5 + comment containing M5 → still suppresses.
  assert(
    !defenseInDepthWouldFire(['G1 X10', 'M5 S0 ; backup M5', 'M2']),
    'real M5 alongside a comment-M5 still suppresses (real M5 wins)',
  );
  // Edge: M5 in a comment with parenthesized markup mid-line.
  assert(
    defenseInDepthWouldFire(['G1 X10', 'G1 X20 (M5)', 'M2']),
    'inline `(M5)` markup is stripped → defense-in-depth fires',
  );
  // Edge: only-a-comment tail.
  assert(
    defenseInDepthWouldFire(['; M5 documentation only', '; another comment']),
    'tail consisting entirely of M5-mentioning comments still triggers append',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
