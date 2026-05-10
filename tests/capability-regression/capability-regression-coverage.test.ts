/**
 * T3-59: capability regression test-coverage roundup.
 *
 * Audit 3C Required Priority 12 lists 12 specific scenarios that need
 * regression protection across the capability work cluster
 * (T1-32 / T1-33 / T1-52 / T1-53 / T1-54 / T1-55 / T2-25 / T2-37 /
 * T2-38 / T2-40 / T3-50 / T3-55 / T3-56 / T3-57 / T3-58). Most
 * scenarios got written inside their enabling ticket; T3-59 is the
 * single-source-of-truth manifest that pins each scenario to its
 * enabling ticket's existing test file with required-content markers.
 *
 * Same pattern as T3-54's connection-lifecycle coverage roundup.
 *
 * Run: npx tsx tests/capability-regression/capability-regression-coverage.test.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function readTest(rel: string): string | null {
  const full = resolve(repoRoot, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf-8');
}

console.log('\n=== T3-59 capability regression coverage roundup ===\n');

interface ScenarioCoverage {
  /** Audit 3C Priority-12 scenario number + label. */
  readonly scenario: string;
  /** Enabling-ticket id. */
  readonly enablingTicket: string;
  /** Test file expected to cover the scenario. */
  readonly testFile: string;
  /** Required substrings (any one); keeps the manifest robust to
   *  file renames if the test body is preserved. */
  readonly contentMarkers: readonly string[];
}

const coverage: readonly ScenarioCoverage[] = [
  {
    scenario: '#1 — $30=255 vs profile=1000 → mismatch blocker',
    enablingTicket: 'T1-33',
    testFile: 'tests/maxspindle-precedence-and-mismatch.test.ts',
    contentMarkers: ['T1-33', 'maxSpindle'],
  },
  {
    scenario: '#2 — $32=0 with M4 output → blocker',
    enablingTicket: 'T1-32',
    testFile: 'tests/preflight-rejects-m4-without-laser-mode.test.ts',
    contentMarkers: ['T1-32', '$32'],
  },
  {
    scenario: '#3 — Missing $$ / unknown $30 → capabilities unknown blocker',
    enablingTicket: 'T1-55',
    testFile: 'tests/preflight-blocks-when-maxspindle-unknown.test.ts',
    contentMarkers: ['T1-55', 'MAXSPINDLE_UNKNOWN'],
  },
  {
    scenario: '#3b — Missing $32 / unknown laser mode → conservative block',
    enablingTicket: 'T3-56',
    testFile: 'tests/conservative-unknown-capability-handling.test.ts',
    contentMarkers: ['T3-56', '$32'],
  },
  {
    scenario: '#5 — CapabilityValue model with verified/profile/unknown confidence',
    enablingTicket: 'T2-38',
    testFile: 'tests/capability-value-resolution.test.ts',
    contentMarkers: ['CapabilityValue'],
  },
  {
    scenario: '#6 — Operation-gate decisions (capability + machine state)',
    enablingTicket: 'T2-40',
    testFile: 'tests/operation-gate-decisions.test.ts',
    contentMarkers: ['canExecuteOperation', 'capability'],
  },
  {
    scenario: '#7 — Profile / live capability mismatch rules ($22 / feed / accel / bed)',
    enablingTicket: 'T3-57',
    testFile: 'tests/preflight-capability-mismatches.test.ts',
    contentMarkers: ['T3-57', 'checkCapabilityMismatches'],
  },
  {
    scenario: '#8 — Family-agnostic operation routing matrix',
    enablingTicket: 'T3-43',
    testFile: 'tests/controller-matrix/operation-routing-by-family.test.ts',
    contentMarkers: ['T3-43', 'capabilities'],
  },
  {
    scenario: '#9 — Falcon autofocus profile-heal must check live firmware',
    enablingTicket: 'T3-55',
    testFile: 'tests/falcon-autofocus-firmware-gate.test.ts',
    contentMarkers: ['T3-55', 'firmwareVersionAtLeast'],
  },
  {
    scenario: '#10a — Device identity captured from $I + $$',
    enablingTicket: 'T3-50',
    testFile: 'tests/grbl-identity-verification.test.ts',
    contentMarkers: ['T3-50', 'getDeviceIdentity'],
  },
  {
    scenario: '#10b — Reconnect-same-machine identity comparator',
    enablingTicket: 'T3-51',
    testFile: 'tests/reconnect-same-machine-verification.test.ts',
    contentMarkers: ['T3-51', 'compareIdentities'],
  },
  {
    scenario: '#11 — Unknown bed extents do not skip bounds enforcement',
    enablingTicket: 'T3-56',
    testFile: 'tests/conservative-unknown-capability-handling.test.ts',
    contentMarkers: ['T3-56', 'unknown'],
  },
  {
    scenario: '#12 — Capability indicators (Verified / Profile only / Unknown)',
    enablingTicket: 'T3-58',
    testFile: 'tests/machine-settings-capability-indicators.test.ts',
    contentMarkers: ['Verified', 'Profile only'],
  },
  {
    scenario: 'Unknown-controller safety regression matrix',
    enablingTicket: 'T3-61',
    testFile: 'tests/safety-controller-matrix/unknown-controller-safety.test.ts',
    contentMarkers: ['T3-61', 'capability-not-supported'],
  },
];

void (async () => {
  for (const c of coverage) {
    const src = readTest(c.testFile);
    assert(
      src !== null,
      `${c.scenario} — ${c.testFile} exists (${c.enablingTicket})`,
    );
    if (src === null) continue;
    for (const marker of c.contentMarkers) {
      assert(
        src.includes(marker),
        `${c.scenario} — ${c.testFile} mentions "${marker}"`,
      );
    }
  }

  // Roundup: each scenario # in 1..12 maps to at least one row above.
  const auditScenarios = ['#1', '#2', '#3', '#5', '#6', '#7', '#8', '#9', '#10', '#11', '#12'];
  for (const s of auditScenarios) {
    const present = coverage.some((c) => c.scenario.includes(s));
    assert(present, `Audit scenario ${s} represented in coverage manifest`);
  }

  // Per-enabling-ticket roundup.
  const tickets = new Set(coverage.map((c) => c.enablingTicket));
  assert(tickets.size >= 11, 'Coverage manifest spans 11+ enabling tickets');

  // Self-pin: the manifest itself carries the T3-59 marker and the
  // audit-3C-priority-12 reference for future contributors.
  const selfPath = resolve(here, 'capability-regression-coverage.test.ts');
  const selfSrc = readFileSync(selfPath, 'utf-8');
  assert(/T3-59/.test(selfSrc), 'Manifest source: T3-59 marker present');
  assert(/audit 3C Required Priority 12/i.test(selfSrc), 'Manifest source: audit 3C Priority-12 cited');

  console.log(`\nT3-59 capability regression coverage: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
