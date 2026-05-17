/**
 * T1-91 regression test: G-code template variable sanitization.
 *
 * Bug: src/core/plan/GcodeTemplates.ts:67, 75 returned user-controlled
 * strings (JOB_NAME, MATERIAL_NAME) verbatim into the G-code template
 * substitution path. A malicious or accidental newline in the project
 * name turned the template's comment line into multiple lines, three of
 * which the controller interprets as G-code:
 *
 *   ; LaserForge job: Innocent Job
 *   M3 S1000          ← interpreted as G-code, fires laser
 *   G4 P5             ← dwells 5 seconds
 *   M5
 *
 * Vectors: typing \n into the project name field, copying SVG <title>
 * during import, editing project files on disk, material preset names.
 *
 * Fix: gcodeCommentSafe helper strips newlines, replaces non-printable /
 * non-ASCII with '?', caps at 120 chars. Applied to JOB_NAME and
 * MATERIAL_NAME (user-controlled) and ESTIMATED_TIME (app-controlled but
 * cheap defense-in-depth).
 *
 * Run: npx tsx tests/gcode-template-sanitization.test.ts
 */
export {};

import {
  BUILT_IN_HEADER_TEMPLATES,
  emptyTemplateContext,
  renderTemplate,
} from '../src/core/plan/GcodeTemplates';
import { createEmptyJob } from '../src/core/job/Job';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';

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

console.log('\n=== gcode template sanitization (T1-91) ===\n');

// ── 1. JOB_NAME with embedded \n is collapsed to single line ─────────
{
  const ctx = { ...emptyTemplateContext(), jobName: 'Innocent Job\nM3 S1000\nG4 P5\nM5' };
  const out = renderTemplate('; LaserForge job: {JOB_NAME}', ctx);
  assert(
    !out.includes('\n'),
    'JOB_NAME with embedded LF: rendered output contains no newlines',
  );
  assert(
    !/M3 S1000/.test(out) || out.startsWith('; LaserForge job:'),
    'JOB_NAME injection: M3 S1000 cannot appear as a standalone line',
  );
  // The injected text becomes part of the comment instead of separate lines.
  assert(
    out.split('\n').length === 1,
    'JOB_NAME injection: exactly one rendered line (got ' + out.split('\n').length + ')',
  );
}

// ── 2. JOB_NAME with \r\n (Windows) is normalized too ───────────────
{
  const ctx = { ...emptyTemplateContext(), jobName: 'Win\r\nLine\r\nEnd' };
  const out = renderTemplate('Job: {JOB_NAME}', ctx);
  assert(
    !out.includes('\r') && !out.includes('\n'),
    'JOB_NAME with CRLF: rendered output contains no \\r or \\n',
  );
}

// ── 3. JOB_NAME with multiple consecutive newlines collapses ────────
{
  const ctx = { ...emptyTemplateContext(), jobName: 'a\n\n\n\nb' };
  const out = renderTemplate('{JOB_NAME}', ctx);
  // The regex /[\r\n]+/g consumes runs in one pass — a single space
  // replaces the entire newline run.
  assert(
    out === 'a b',
    `JOB_NAME with multiple LFs: collapses to single space (got "${out}")`,
  );
}

// ── 4. JOB_NAME with non-ASCII becomes '?' (deliberate ASCII policy) ──
{
  const ctx = { ...emptyTemplateContext(), jobName: 'Café' };
  const out = renderTemplate('{JOB_NAME}', ctx);
  assert(
    out === 'Caf?',
    `JOB_NAME with non-ASCII (Café): rendered as "Caf?" (got "${out}")`,
  );
}

// ── 5. JOB_NAME with control chars (\t, \v, \0) all replaced ────────
{
  const ctx = { ...emptyTemplateContext(), jobName: 'a\tb\vc\u0000d' };
  const out = renderTemplate('{JOB_NAME}', ctx);
  assert(
    out === 'a?b?c?d',
    `JOB_NAME with control chars: each replaced (got "${out}")`,
  );
}

// ── 6. JOB_NAME at exactly 120 chars: preserved (boundary) ──────────
{
  const longName = 'X'.repeat(120);
  const ctx = { ...emptyTemplateContext(), jobName: longName };
  const out = renderTemplate('{JOB_NAME}', ctx);
  assert(out.length === 120, `JOB_NAME=120 chars: preserved (got ${out.length})`);
}

// ── 7. JOB_NAME at 121 chars: truncated to 120 ──────────────────────
{
  const tooLong = 'X'.repeat(121);
  const ctx = { ...emptyTemplateContext(), jobName: tooLong };
  const out = renderTemplate('{JOB_NAME}', ctx);
  assert(out.length === 120, `JOB_NAME=121 chars: truncated to 120 (got ${out.length})`);
}

// ── 8. JOB_NAME with newline AND length > 120: both rules apply ─────
{
  // 50 chars, then a newline, then 200 more chars: after sanitization
  // the newline becomes a space (length 251), then truncated to 120.
  const head = 'A'.repeat(50);
  const tail = 'B'.repeat(200);
  const ctx = { ...emptyTemplateContext(), jobName: `${head}\n${tail}` };
  const out = renderTemplate('{JOB_NAME}', ctx);
  assert(
    out.length === 120 && !out.includes('\n'),
    `JOB_NAME mixed: 120-char cap + no newlines (got len=${out.length})`,
  );
  // Specifically: 50 'A's + 1 ' ' (the replaced newline) + 69 'B's = 120 chars.
  assert(
    out === 'A'.repeat(50) + ' ' + 'B'.repeat(69),
    'JOB_NAME mixed: sanitize-then-truncate ordering preserved',
  );
}

// ── 9. MATERIAL_NAME empty falls back to 'none' (existing behavior) ─
{
  const out = renderTemplate('{MATERIAL_NAME}', emptyTemplateContext());
  assert(out === 'none', `MATERIAL_NAME empty: falls back to "none" (got "${out}")`);
}

// ── 10. MATERIAL_NAME with newline: sanitized but preserved ──────────
{
  const ctx = { ...emptyTemplateContext(), materialName: 'Birch\nply 3mm' };
  const out = renderTemplate('{MATERIAL_NAME}', ctx);
  assert(
    out === 'Birch ply 3mm',
    `MATERIAL_NAME with LF: sanitized (got "${out}")`,
  );
}

// ── 11. ESTIMATED_TIME with newline: defense-in-depth catches it ────
{
  const ctx = { ...emptyTemplateContext(), estimatedTime: '5m\nM3 S1000' };
  const out = renderTemplate('{ESTIMATED_TIME}', ctx);
  assert(
    out === '5m M3 S1000',
    `ESTIMATED_TIME with LF: sanitized via defense-in-depth (got "${out}")`,
  );
}

// ── 12. Numeric variables unaffected by the change ─────────────────
{
  const ctx = { ...emptyTemplateContext(), bedWidthMm: 600, maxSpeedMmPerMin: 12000 };
  const out = renderTemplate('{BED_WIDTH} {MAX_SPEED}', ctx);
  assert(
    out === '600 12000',
    `numeric variables untouched (got "${out}")`,
  );
}

// ── 13. End-to-end injection test against the default header template ─
// The "GRBL (generic)" header template has 7 lines. A malicious job
// name with embedded newlines and material name with embedded newlines
// must not change that line count.
{
  const benign = renderTemplate(
    BUILT_IN_HEADER_TEMPLATES['GRBL (generic)']!,
    {
      ...emptyTemplateContext(),
      jobName: 'My Project',
      materialName: 'Birch',
    },
  );
  const benignLineCount = benign.split('\n').length;

  const malicious = renderTemplate(
    BUILT_IN_HEADER_TEMPLATES['GRBL (generic)']!,
    {
      ...emptyTemplateContext(),
      jobName: 'Innocent Job\nM3 S1000\nG4 P5\nM5',
      materialName: 'Birch\nG0 X100 Y100\nG1 F500',
    },
  );
  const maliciousLineCount = malicious.split('\n').length;

  assert(
    benignLineCount === 7,
    `benign default header has 7 lines (got ${benignLineCount})`,
  );
  assert(
    maliciousLineCount === benignLineCount,
    `malicious input does NOT add lines: got ${maliciousLineCount}, expected ${benignLineCount}`,
  );
  assert(
    !malicious.split('\n').some(line => /^M3 S1000\s*$/.test(line)),
    'no rendered line is a bare "M3 S1000" command',
  );
  assert(
    !malicious.split('\n').some(line => /^G4 P5\s*$/.test(line)),
    'no rendered line is a bare "G4 P5" command',
  );
}

// ── 14. Substitution does not recurse on its own output ─────────────
// If the sanitizer somehow left a {VAR} pattern in its output, the
// outer regex must not re-match it. (It can't, because String.replace
// with a regex+function only walks the input once. Sanity check.)
{
  const ctx = { ...emptyTemplateContext(), jobName: '{JOB_NAME}' };
  const out = renderTemplate('header: {JOB_NAME}', ctx);
  assert(
    out === 'header: {JOB_NAME}',
    `no recursion: literal "{JOB_NAME}" in jobName remains as-is (got "${out}")`,
  );
}

// ── 15. Default safety header sanitizes JOB_NAME before baseline ────
{
  const job = createEmptyJob('Innocent Job\nM3 S1000\nG4 P5\nM5', 's25-05');
  job.metadata.objectCount = 0;
  job.metadata.layerCount = 0;
  const plan = createEmptyPlan(job.id);
  const output = new GrblOutputStrategy().generate(plan, job, {
    startMode: 'absolute',
    clock: () => '2026-05-17T00:00:00.000Z',
  });
  const text = output.text ?? '';
  const lines = text.split('\n');
  const codeLines = lines
    .map(line => line.replace(/;.*$/, '').trim())
    .filter(line => line.length > 0);

  assert(
    !lines.some(line => /^M3 S1000\s*$/.test(line)),
    'default header: malicious job name cannot emit bare "M3 S1000"',
  );
  assert(
    !lines.some(line => /^G4 P5\s*$/.test(line)),
    'default header: malicious job name cannot emit bare "G4 P5"',
  );
  assert(
    !lines.some(line => /^M5\s*$/.test(line)),
    'default header: malicious job name cannot emit bare "M5"',
  );
  assert(
    /^;\s*Job: Innocent Job M3 S1000 G4 P5 M5$/.test(lines[1] ?? ''),
    `default header: injected text remains a single comment line (got "${lines[1] ?? ''}")`,
  );
  assert(
    /^G21\b/.test(codeLines[0] ?? ''),
    `default header: first executable line is the safety baseline G21 (got "${codeLines[0] ?? ''}")`,
  );
  assert(
    codeLines.slice(0, 5).some(line => /^M5 S0\b/.test(line)),
    'default header: laser-off safety baseline remains in the first executable block',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
