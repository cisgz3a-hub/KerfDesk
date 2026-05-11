/**
 * T1-26: defense-in-depth M5 append in BaseGCodeStrategy.encode.
 *
 * Run: npx tsx tests/footer-m5-appended-at-send.test.ts
 */

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function appendM5IfMissing(linesIn: string[]): string[] {
  const lines = [...linesIn];
  const tailNonEmpty = lines
    .filter(line => line.trim().length > 0)
    .slice(-5);

  // T1-167 (audit F-024): mirror production by stripping `;` line-
  // comments AND `(...)` parenthesized comments before the regex.
  // Pre-T1-167 a user template ending `; remember to send M5` would
  // falsely match and skip the append.
  const tailCodeOnly = tailNonEmpty
    .map(line => line.replace(/\([^)]*\)/g, '').replace(/;.*$/, ''))
    .join('\n');

  if (!/\bM5\b/i.test(tailCodeOnly)) {
    lines.push('M5 S0 ; T1-26 defense-in-depth laser-off');
  }

  return lines;
}

console.log('\n=== T1-26 footer M5 append at send ===\n');

{
  const result = appendM5IfMissing([
    '; --- layer 1 ---',
    'G1 X10 Y10',
    'M5 S0',
    'M2 ; program end',
  ]);
  assertContract(
    result.filter(line => /\bM5\b/i.test(line)).length === 1
      && result[result.length - 1] === 'M2 ; program end',
    'footer already has M5: append is idempotent',
  );
}

{
  const result = appendM5IfMissing([
    '; --- layer 1 ---',
    'G1 X10 Y10',
    'M2 ; program end',
  ]);
  assertContract(
    result.filter(line => /\bM5\b/i.test(line)).length === 1
      && /M5 S0/.test(result[result.length - 1] ?? '')
      && /T1-26/.test(result[result.length - 1] ?? ''),
    'footer lacks M5: append fires with T1-26 marker',
  );
}

{
  const result = appendM5IfMissing([
    'G1 X10 Y10',
    'M5',
    'G0 X0 Y0',
    'M2',
  ]);
  assertContract(
    result.filter(line => /\bM5\b/i.test(line)).length === 1,
    'M5 in last-5 region but not last line: no append',
  );
}

{
  const result = appendM5IfMissing([
    'G1 X10 Y10',
    'm5 s0',
    'M2',
  ]);
  assertContract(
    result.filter(line => /\bM5\b/i.test(line)).length === 1,
    'lowercase m5 in tail: no append',
  );
}

{
  const result = appendM5IfMissing([
    'G21',
    'M5 ; safety in header',
    'G90',
    'M3 S0',
    '; --- layer 1 ---',
    'G1 X10 Y10',
    'G1 X20 Y20',
    'G1 X30 Y30',
    'G0 X0 Y0',
    'M2 ; program end',
  ]);
  assertContract(
    /\bM5 S0\b/.test(result[result.length - 1] ?? '')
      && result.filter(line => /\bM5\b/i.test(line)).length === 2,
    'M5 only in header: tail scan still appends final M5',
  );
}

{
  // T1-167 (audit F-024): post-fix behavior. M5 mentioned only inside
  // a `;` line-comment is documentation, not a real laser-off command.
  // The defense-in-depth scan strips comments first and DOES append a
  // real M5 in this case. Pre-T1-167 this test asserted the opposite
  // (and was codifying the bug — the laser would have stayed ON if
  // T2-14's safety footer was also bypassed).
  const result = appendM5IfMissing([
    'G1 X10 Y10',
    'M2 ; M5 was here',
  ]);
  assertContract(
    result.filter(line => /\bM5\b/i.test(line)).length === 2
      && /M5 S0/.test(result[result.length - 1] ?? '')
      && /T1-26/.test(result[result.length - 1] ?? ''),
    'M5 only in a `;` comment: T1-167 strips comments → defense-in-depth append fires',
  );
}

{
  // T1-167 (audit F-024): same coverage for parenthesized comments,
  // GRBL's other comment syntax. `(M5)` is documentation, not code.
  const result = appendM5IfMissing([
    'G1 X10 Y10',
    'M2 (M5 reminder)',
  ]);
  assertContract(
    result.filter(line => /\bM5\b/i.test(line)).length === 2
      && /M5 S0/.test(result[result.length - 1] ?? '')
      && /T1-26/.test(result[result.length - 1] ?? ''),
    'M5 only in a `(...)` comment: T1-167 strips comments → defense-in-depth append fires',
  );
}

{
  const result = appendM5IfMissing([
    'G1 X10 Y10',
    '',
    'M2',
    '',
  ]);
  assertContract(
    result.filter(line => /\bM5\b/i.test(line)).length === 1
      && /M5 S0/.test(result[result.length - 1] ?? ''),
    'empty lines are ignored before tail scan',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
