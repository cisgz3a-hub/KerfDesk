/**
 * T1-120: regression test that the wired-into-product gate stays in
 * the workflow contract. Pre-T1-120 the audit ledger had no checkbox
 * distinguishing "type exists" from "product path uses it"; tickets
 * could be marked shipped against unit tests of an isolated helper.
 * The audit's Phase 2 #9 finding called this out as the root cause
 * of multiple "foundation exists but product does not use it" bugs
 * (RecoveryState, Falcon WiFi trust, MigrationPipeline before T1-119,
 * server-signed entitlement tokens, controller abstraction).
 *
 * This test pins:
 *   1. CLAUDE.md carries the explicit wired-into-product gate
 *      language so a future edit can't quietly delete it.
 *   2. docs/TICKET-LEDGER-FORMAT.md exists with the per-ticket
 *      status checklist + the (a)/(b) verification recipe.
 *   3. Both files reference each other so a reader can navigate
 *      between them.
 *
 * Run: npx tsx tests/ticket-ledger-format-required.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

console.log('\n=== T1-120 wired-into-product gate present in workflow contract ===\n');

// -------- CLAUDE.md gate language --------
{
  const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
  assert(
    /Wired-into-product gate/i.test(claudeMd),
    'CLAUDE.md carries the "Wired-into-product gate" headline',
  );
  assert(
    /T1-120/.test(claudeMd),
    'CLAUDE.md carries a T1-120 marker pointing back at the gate',
  );
  assert(
    /docs\/TICKET-LEDGER-FORMAT\.md/.test(claudeMd),
    'CLAUDE.md links to docs/TICKET-LEDGER-FORMAT.md for the per-ticket format',
  );
  assert(
    /(consumed by a production code path|production code path)/i.test(claudeMd),
    'CLAUDE.md mandates a production code path consumes the new code',
  );
  assert(
    /integration|end-to-end|live wiring/i.test(claudeMd),
    'CLAUDE.md mandates integration / live-wiring test coverage',
  );
  assert(
    /\(a\)[\s\S]+?\(b\)/.test(claudeMd),
    'CLAUDE.md gives the (a)/(b) checklist a committer should run before claiming Shipped',
  );
  assert(
    /Unit-only tests|type that nothing imports|no live caller/i.test(claudeMd),
    'CLAUDE.md names the failure mode (unit-only / type-only / no-live-caller) explicitly',
  );
}

// -------- docs/TICKET-LEDGER-FORMAT.md exists with the audit's checklist --------
{
  const formatPath = resolve(repoRoot, 'docs/TICKET-LEDGER-FORMAT.md');
  assert(existsSync(formatPath), 'docs/TICKET-LEDGER-FORMAT.md exists');
  const format = readFileSync(formatPath, 'utf-8');

  const expectedCheckboxes = [
    'Type / API exists',
    'Unit tests exist',
    'Product path uses it',
    'UI reflects it',
    'Integration',
    'Regression test added',
  ];
  for (const c of expectedCheckboxes) {
    assert(
      format.includes(c),
      `format doc includes "${c}" checkbox label`,
    );
  }

  assert(
    /Shipped:\s*yes\s*\/\s*no\s*\/\s*partial/i.test(format),
    'format doc declares the Shipped tri-state (yes / no / partial)',
  );
  assert(
    /Product path uses it\s*=\s*yes/i.test(format)
    && /Integration test covers\s*=\s*yes/i.test(format),
    'format doc gates Shipped:yes on both product-path AND integration coverage',
  );
  assert(
    /git grep/i.test(format),
    'format doc gives concrete git grep recipes for the (a)/(b) checks',
  );
  assert(
    /RecoveryState|Falcon WiFi|MigrationPipeline|server-signed|streaming output|controller abstraction/i.test(format),
    'format doc names the audit-flagged retrofit candidates',
  );
}

// -------- the format doc names T1-119 as the first retrofit closed (sanity check the document is current) --------
{
  const format = readFileSync(resolve(repoRoot, 'docs/TICKET-LEDGER-FORMAT.md'), 'utf-8');
  assert(
    /T1-119/.test(format),
    'format doc references T1-119 (MigrationPipeline wiring closure) as evidence the gate works',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
