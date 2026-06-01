/**
 * T1-196 (external audit High #15 contract-validation slice):
 * `MarlinFirmwareAdapter` stub.
 *
 * Purpose: prove the FirmwareAdapter type contract is satisfiable
 * by a non-GRBL adapter. The audit identified Marlin / Ruida /
 * Smoothie as output-format labels with no real backing — T1-192
 * shipped the contract; T1-196 ships a Marlin stub that satisfies
 * it structurally without requiring a full implementation.
 *
 * What this test pins:
 *   - The stub declares Marlin-specific capabilities (no dynamic
 *     laser, no realtime status query, supports arcs).
 *   - emit() and stream() throw / reject with the documented
 *     MARLIN_NOT_IMPLEMENTED code so support bundles can attribute
 *     failures cleanly.
 *   - validate() returns a single MARLIN_NOT_IMPLEMENTED error
 *     finding (callers can detect "Marlin not yet supported" and
 *     prompt accordingly).
 *   - recover() uses firmware-independent step kinds (the recovery
 *     taxonomy works for Marlin without modification).
 *
 * Run: npx tsx tests/marlin-firmware-adapter-stub.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMarlinFirmwareAdapter, MarlinNotYetSupportedError } from '../src/controllers/MarlinFirmwareAdapter';
import { getGrblFirmwareAdapter } from '../src/controllers/GrblFirmwareAdapter';
import type { LiveMachineIdentity, OutputArtifact, MachineFault } from '../src/controllers/FirmwareAdapter';
import { createEmptyJob } from '../src/core/job/Job';
import { createEmptyPlan } from '../src/core/plan/Plan';

let passed = 0;
let failed = 0;
const asyncChecks: Promise<void>[] = [];

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

console.log('\n=== T1-196 MarlinFirmwareAdapter stub (contract validation) ===\n');

const marlin = getMarlinFirmwareAdapter();
const grbl = getGrblFirmwareAdapter();

// -------- 1. Marlin capabilities differ from GRBL where the audit said --------
{
  const m = marlin.capabilities();
  const g = grbl.capabilities();
  assert(m.id === 'marlin', `marlin.id === 'marlin'`);
  assert(g.id === 'grbl', `grbl.id === 'grbl'`);
  assert(
    m.supportsDynamicLaserPower === false && g.supportsDynamicLaserPower === true,
    'Marlin has no M4 dynamic laser; GRBL does',
  );
  assert(
    m.supportsRealtimeStatusQuery === false && g.supportsRealtimeStatusQuery === true,
    'Marlin uses M114 polling; GRBL has `?` realtime query',
  );
  assert(
    m.supportsWorkOffsetQuery === false && g.supportsWorkOffsetQuery === true,
    'Marlin uses M114/G92 differently; GRBL has `$#` query',
  );
  // Shared: both support arcs.
  assert(m.supportsArcs === true && g.supportsArcs === true, 'both support G2/G3 arcs');
  // Both host-streamed adapters stop new host input on disconnect, but
  // GRBL must not claim already-buffered firmware motion is halted.
  assert(m.disconnectStopsJob === true && g.disconnectStopsJob === false,
    'GRBL does not claim physical halt-on-disconnect');
}

// -------- 2. emit() throws MarlinNotYetSupportedError --------
{
  const plan = createEmptyPlan('p');
  const job = createEmptyJob('j', 'test');
  asyncChecks.push(marlin.emit(plan, job).then(
    () => assert(false, 'emit() throws MarlinNotYetSupportedError'),
    (caught: unknown) => {
      assert(caught instanceof MarlinNotYetSupportedError, 'emit() throws MarlinNotYetSupportedError');
      if (caught instanceof MarlinNotYetSupportedError) {
        assert(caught.code === 'MARLIN_NOT_IMPLEMENTED', 'error.code === MARLIN_NOT_IMPLEMENTED');
        assert(/T1-196 stub/.test(caught.message), 'error message names T1-196');
      }
    },
  ));
}

// -------- 3. validate() returns the MARLIN_NOT_IMPLEMENTED error finding --------
{
  const artifact: OutputArtifact = {
    kind: 'gcode-lines', firmware: 'marlin', lines: [], burnBounds: null,
  };
  const live: LiveMachineIdentity = {
    firmwareVersion: 'Marlin 2.1', buildOptions: null, maxSpindle: 1000,
    bedWidthMm: 220, bedHeightMm: 220, homingEnabled: true, laserMode: false,
  };
  const findings = marlin.validate(artifact, live).findings;
  assert(findings.length === 1, `exactly 1 finding (got ${findings.length})`);
  assert(findings[0].code === 'MARLIN_NOT_IMPLEMENTED', `finding code matches`);
  assert(findings[0].severity === 'error', `finding severity is 'error'`);
  assert(findings[0].fix !== undefined && /GRBL/.test(findings[0].fix), 'fix recommends using GRBL');
}

// -------- 4. stream() rejects with MarlinNotYetSupportedError --------
{
  const artifact: OutputArtifact = {
    kind: 'gcode-lines', firmware: 'marlin', lines: [], burnBounds: null,
  };
  const session = marlin.stream(artifact);
  assert(session.sessionId.startsWith('marlin-stub-'), 'session has marlin-stub prefix');
  void session.completed.catch((err: unknown) => {
    assert(err instanceof MarlinNotYetSupportedError, 'stream rejects with MarlinNotYetSupportedError');
  });
}

// -------- 5. recover() produces a firmware-independent plan --------
{
  const event: MachineFault = { kind: 'alarm', message: 'test', observedAt: 0 };
  const plan = marlin.recover(event);
  assert(plan.faultKind === 'alarm', 'plan.faultKind matches');
  assert(plan.steps.length >= 1, 'plan has at least 1 step');
  const stepKinds = new Set(plan.steps.map(s => s.kind));
  // Marlin's recovery taxonomy doesn't need GRBL-specific steps
  // (no `clear-alarm` via `$X`; Marlin uses `M999`). The shared
  // taxonomy (inspect-machine, reconnect) covers the user-facing
  // contract; a real Marlin recover() would add Marlin-specific
  // auto-steps.
  assert(stepKinds.has('inspect-machine'), 'plan includes inspect-machine');
  assert(stepKinds.has('reconnect'), 'plan includes reconnect');
}

// -------- 6. Source pins --------
{
  const src = readFileSync(resolve(here, '../src/controllers/MarlinFirmwareAdapter.ts'), 'utf-8');
  assert(/T1-196/.test(src), 'MarlinFirmwareAdapter.ts carries T1-196 marker');
  assert(/audit High #15/.test(src), 'cross-references audit High #15');
  assert(/implements FirmwareAdapter/.test(src), 'class implements FirmwareAdapter');
  assert(/getMarlinFirmwareAdapter/.test(src), 'singleton accessor exported');
  assert(/MarlinNotYetSupportedError/.test(src), 'typed error class exported');
  // Doc names what a real implementation would need so a future
  // author has a checklist.
  assert(
    /MarlinOutputStrategy/.test(src),
    'doc names MarlinOutputStrategy as a future requirement',
  );
}

Promise.all(asyncChecks).then(() => {
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
