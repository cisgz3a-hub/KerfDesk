/**
 * T1-162 (audit F-012 + F-061): sweep stale `T*-followup` doc strings
 * in `src/app/`. Pre-T1-162 several modules carried doc strings that
 * said "the wiring is filed as T*-followup" when the wiring had
 * actually shipped. Examples:
 *
 *   - `SafetyActionResult.ts`: claimed pause/resume/stop/emergencyStop
 *     "stay void for now" — but GrblController.pause/resume/stop/
 *     emergencyStop all return `SafetyActionResult` today.
 *   - `SafetyStateMachine.ts`: claimed "Wiring the machine into
 *     MachineService is filed as T2-44-followup" — but
 *     `_recordSafetyResult` calls `transitionFromSafetyResult` today.
 *
 * Newcomers reading these doc strings would believe more work is
 * outstanding than actually is, and the audit's F-005 / F-058 systemic
 * count of "30+ framework-only modules" was inflated by them.
 *
 * T1-162 updates both doc strings to reflect actual code state, and
 * cross-references the audit finding. This regression test pins that
 * the stale claims are gone AND the audit cross-reference is present
 * so a future doc edit doesn't silently re-introduce the drift.
 *
 * Run: npx tsx tests/stale-followup-doc-sweep.test.ts
 */
import { readFileSync } from 'node:fs';
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

console.log('\n=== T1-162 stale T*-followup doc-string sweep ===\n');

// -------- 1. SafetyActionResult.ts: stale T2-41-followup language gone --------
{
  const src = readFileSync(
    resolve(here, '../src/app/SafetyActionResult.ts'),
    'utf-8',
  );
  // The pre-T1-162 doc said the "remaining methods stay void for now"
  // and pointed at T2-41-followup as the migration ticket.
  assert(
    !/stay void for now/.test(src),
    'SafetyActionResult: "stay void for now" claim is gone',
  );
  // The new doc may quote the old sentence as part of its
  // "this was true at shipped time but is stale" explanation, so
  // check the claim is no longer presented as the CURRENT state.
  // Concretely: the bare "T2-41-followup migrates the remaining
  // methods one-by-one with paired tests." sentence as a closing
  // statement (not quoted in scare-quotes) is what we want gone.
  assert(
    !/paired tests\.\s*\*\/?\s*$/m.test(src.split(/\n/).find((l) => /T2-41-followup migrates/.test(l)) ?? ''),
    'SafetyActionResult: T2-41-followup line is no longer the doc\'s closing assertion',
  );
  // T1-162 cross-reference + audit reference must be present.
  assert(
    /T1-162/.test(src),
    'SafetyActionResult: T1-162 update marker present',
  );
  assert(
    /AUDIT-2026-05-11\.md F-012|audit.*F-012/.test(src),
    'SafetyActionResult: cross-references audit F-012',
  );
  // The doc now reflects actual state.
  assert(
    /migration is complete/.test(src),
    'SafetyActionResult: doc now states migration is complete',
  );
}

// -------- 2. SafetyStateMachine.ts: stale T2-44-followup language gone --------
{
  const src = readFileSync(
    resolve(here, '../src/app/SafetyStateMachine.ts'),
    'utf-8',
  );
  // Pre-T1-162: "Wiring the machine into MachineService is filed as
  // T2-44-followup since it touches every safety method caller."
  assert(
    !/Wiring the machine into MachineService\s+is filed as\s+T2-44-followup/s.test(src),
    'SafetyStateMachine: original "Wiring is filed as T2-44-followup" claim is gone',
  );
  assert(
    /T1-162/.test(src),
    'SafetyStateMachine: T1-162 update marker present',
  );
  assert(
    /AUDIT-2026-05-11\.md F-012|audit.*F-012/.test(src),
    'SafetyStateMachine: cross-references audit F-012',
  );
  assert(
    /wiring is complete/.test(src),
    'SafetyStateMachine: doc now states wiring is complete',
  );
}

// -------- 3. The actual wiring still exists (regression bait) --------
{
  // If somebody removes the actual call in MachineService while updating
  // the doc, we want to fail the test. The doc says "wiring is complete"
  // — verify the call still exists.
  const ms = readFileSync(
    resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(
    /transitionFromSafetyResult\(/.test(ms),
    'MachineService still calls transitionFromSafetyResult (the wiring exists)',
  );
  assert(
    /_recordSafetyResult/.test(ms),
    'MachineService still defines _recordSafetyResult (the routing exists)',
  );
}

// -------- 4. GrblController safety methods return SafetyActionResult --------
{
  const ctrl = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  // Each safety method's signature should declare SafetyActionResult.
  for (const method of ['pause', 'resume', 'stop', 'emergencyStop']) {
    const sig = new RegExp(`^\\s*${method}\\(\\)\\s*:\\s*SafetyActionResult`, 'm');
    assert(
      sig.test(ctrl),
      `GrblController.${method} returns SafetyActionResult (post-migration)`,
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
