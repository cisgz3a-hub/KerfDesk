/**
 * T1-168 (audit F-025): `validateTemplatesBeforeEmission` aggregates
 * every error-severity finding into a single `TemplateValidationError`
 * and exposes warning-severity findings instead of dropping them.
 *
 * Pre-T1-168:
 *  - `validateGcodeTemplates(...)` returns `TemplateFinding[]` with
 *    severity 'error' or 'warning'.
 *  - `validateTemplatesBeforeEmission` did
 *    `findings.find(f => f.severity === 'error')` and threw on the
 *    first error → 2 or 3 errors in a template needed 2 or 3 compile
 *    roundtrips to surface (UX gap from the audit).
 *  - Warning-severity findings were dropped entirely (UX gap from the
 *    audit).
 *
 * Post-T1-168:
 *  - `TemplateValidationError` carries:
 *    - `finding` (backwards-compat: `errors[0]`)
 *    - `errors: readonly TemplateFinding[]` (every error-severity finding)
 *    - `warnings: readonly TemplateFinding[]` (every warning-severity finding)
 *  - `error.message` summarizes: first error verbatim + "(+N more
 *    errors)" when there are multiple.
 *  - Constructor throws if `errors` is empty (defensive — callers
 *    should only build this when there's at least one error finding).
 *
 * Run: npx tsx tests/template-validation-aggregates-errors.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJob } from '../src/core/job/Job';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import { TemplateValidationError } from '../src/core/output/Output';
import { emptyTemplateContext } from '../src/core/plan/GcodeTemplates';

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

console.log('\n=== T1-168 template validation aggregates errors + surfaces warnings ===\n');

const strategy = new GrblOutputStrategy();
const job = createEmptyJob('T1-168-template', 'test-project');
const plan = createEmptyPlan(job.id);
const context = {
  ...emptyTemplateContext(),
  jobName: job.name,
  bedWidthMm: 100,
  bedHeightMm: 100,
  maxSpeedMmPerMin: 1200,
};

// -------- 1. Single-error path: backwards-compat `finding` is errors[0] --------
{
  let caught: TemplateValidationError | null = null;
  try {
    strategy.generate(plan, job, {
      gcodeHeaderTemplate: '$RST=*',
      gcodeTemplateContext: context,
      maxSpindle: 1000,
    });
  } catch (e) {
    caught = e instanceof TemplateValidationError ? e : null;
  }
  assert(caught !== null, 'single-error: throws TemplateValidationError for header `$RST=*`');
  if (caught) {
    assert(caught.errors.length === 1, `single-error: errors.length === 1 (got ${caught.errors.length})`);
    assert(caught.finding === caught.errors[0], 'single-error: finding === errors[0] (backwards-compat alias)');
    assert(
      caught.errors[0].severity === 'error',
      'single-error: errors[0].severity === "error"',
    );
    assert(
      !/\+\d+ more errors?/.test(caught.message),
      'single-error: message has no "(+N more)" suffix',
    );
  }
}

// -------- 2. Multi-error path: every error-severity finding is captured --------
{
  // Combine header + footer + customStart errors. `$RST=*` is a
  // banned reset header line; a footer without M5 is an error; the
  // customStart `M3 S100` is a banned laser-on. We expect 2+ errors.
  let caught: TemplateValidationError | null = null;
  try {
    strategy.generate(plan, job, {
      gcodeHeaderTemplate: '$RST=*',
      gcodeFooterTemplate: '; footer without laser off',
      customStartGcode: 'M3 S100 ; banned laser-on in custom start',
      gcodeTemplateContext: context,
      maxSpindle: 1000,
    });
  } catch (e) {
    caught = e instanceof TemplateValidationError ? e : null;
  }
  assert(caught !== null, 'multi-error: throws TemplateValidationError when 2+ templates have errors');
  if (caught) {
    assert(
      caught.errors.length >= 2,
      `multi-error: errors.length >= 2 (got ${caught.errors.length})`,
    );
    // Every captured finding must be severity 'error'.
    assert(
      caught.errors.every(f => f.severity === 'error'),
      'multi-error: every captured finding is severity "error"',
    );
    // Message includes the "(+N more errors)" tail.
    assert(
      /\+\d+ more error/.test(caught.message),
      `multi-error: message has "(+N more errors)" suffix (got "${caught.message}")`,
    );
    // No duplicates (each finding is reported once).
    const codes = caught.errors.map(f => `${f.source}:${f.lineNumber}:${f.code}`);
    const unique = new Set(codes);
    assert(unique.size === codes.length, 'multi-error: no duplicate findings in errors');
  }
}

// -------- 3. Constructor rejects empty errors --------
{
  let threwGuard = false;
  try {
    new TemplateValidationError([]);
  } catch (e) {
    threwGuard = e instanceof Error && /at least one error/i.test(e.message);
  }
  assert(threwGuard, 'constructor: rejects empty errors array (defensive)');
}

// -------- 4. Warnings attached when there are also warnings --------
{
  // Construct directly to assert the surface, then exercise via the
  // production path. Source-pinning matters because validateGcodeTemplates
  // is the only source of warning-severity findings; we don't have to
  // synthesize a real warning to assert the wiring.
  const err = new TemplateValidationError(
    [
      {
        source: 'header',
        severity: 'error',
        lineNumber: 1,
        line: 'X',
        code: 'ERR_A',
        message: 'first',
      },
      {
        source: 'header',
        severity: 'error',
        lineNumber: 2,
        line: 'Y',
        code: 'ERR_B',
        message: 'second',
      },
    ],
    [
      {
        source: 'footer',
        severity: 'warning',
        lineNumber: 3,
        line: 'Z',
        code: 'WARN_A',
        message: 'minor',
      },
    ],
  );
  assert(err.errors.length === 2, 'direct-construct: errors.length === 2');
  assert(err.warnings.length === 1, 'direct-construct: warnings.length === 1');
  assert(err.warnings[0].severity === 'warning', 'direct-construct: warnings[0].severity === "warning"');
  assert(err.finding.code === 'ERR_A', 'direct-construct: finding === errors[0]');
  assert(/ERR_A.*first.*\+1 more error/.test(err.message), 'direct-construct: message includes "(+1 more error)" form');
}

// -------- 5. Warnings default to empty array when omitted --------
{
  const err = new TemplateValidationError([
    {
      source: 'header',
      severity: 'error',
      lineNumber: 1,
      line: 'X',
      code: 'ERR_A',
      message: 'first',
    },
  ]);
  assert(Array.isArray(err.warnings) && err.warnings.length === 0, 'omit-warnings: defaults to []');
}

// -------- 6. Source pins on the implementation --------
{
  const outputSrc = readFileSync(resolve(here, '../src/core/output/Output.ts'), 'utf-8');
  assert(/T1-168/.test(outputSrc), 'Output.ts carries T1-168 marker');
  assert(/audit F-025/.test(outputSrc), 'Output.ts cross-references audit F-025');
  // The pre-T1-168 single-error throw line must be gone.
  assert(
    !/new TemplateValidationError\(firstError\)/.test(outputSrc),
    'Output.ts no longer constructs the error from a single `firstError`',
  );
  // The new aggregate-throw must be present.
  assert(
    /new TemplateValidationError\(errors,\s*warnings\)/.test(outputSrc),
    'Output.ts constructs the error from (errors, warnings) array pair',
  );
  // The class carries `errors` and `warnings` fields.
  assert(
    /readonly errors:\s*readonly TemplateFinding\[\]/.test(outputSrc),
    'TemplateValidationError declares `errors: readonly TemplateFinding[]`',
  );
  assert(
    /readonly warnings:\s*readonly TemplateFinding\[\]/.test(outputSrc),
    'TemplateValidationError declares `warnings: readonly TemplateFinding[]`',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
