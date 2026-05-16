/**
 * T1-199 (extends T1-195 + T1-198): wire the four `job-*` lifecycle
 * events into the MachineEventLedger.
 *
 * Sites wired in this slice:
 *   1. `MachineService.startValidatedJob` — appends `job-start` after
 *      `setUnsafePriorState` (the durable commitment point) and before
 *      `executeJob`.
 *   2. `MachineService.tryFinalizeJobLog` — appends one of
 *      `job-completed` / `job-failed` / `job-stopped` based on the
 *      derived status before the log is finalized.
 *
 * Pre-T1-199 the four `job-*` event kinds were declared in T1-193's
 * MachineEvent union but had no writers. T1-195 wired
 * disconnect-while-running, emergency-stop, failed-to-start, and
 * burn-envelope-divergence; T1-198 wired safety-off. T1-199 closes
 * the lifecycle by writing the start + terminal pair.
 *
 * Run: npx tsx tests/machine-event-ledger-job-lifecycle-wiring.test.ts
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

console.log('\n=== T1-199 MachineEventLedger job-* lifecycle wiring ===\n');

// -------- Source pins on the wiring --------
//
// T1-199 is a wiring-only change inside MachineService.ts. The full
// behavioural integration test would need the entire executeJob
// machinery driven through a mock controller's progress stream, which
// is out of scope for this observability slice. The source-pins prove
// the appends are present at the right locations with the right
// payload shape; the ledger primitive itself is exercised by
// `tests/machine-event-ledger.test.ts` (39 contracts pinning append /
// query / tail behaviour).

const svcSrc = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');

assert(/T1-199/.test(svcSrc), 'MachineService.ts carries T1-199 marker');

// 1. job-start append present, inside startValidatedJob, after
//    setUnsafePriorState.
{
  const startMethod = svcSrc.slice(
    svcSrc.indexOf('async startValidatedJob('),
    svcSrc.indexOf('async startValidatedJob(') + 14000,
  );
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'job-start'/.test(startMethod),
    'startValidatedJob appends job-start event',
  );
  // job-start must include ticketId + sceneHash per the discriminated
  // union shape (`{ kind: 'job-start'; t; ticketId: string; sceneHash:
  // string }`).
  const jobStartIdx = startMethod.indexOf("kind: 'job-start'");
  const jobStartBlock = startMethod.slice(jobStartIdx, jobStartIdx + 400);
  assert(/ticketId:\s*ticket\.ticketId/.test(jobStartBlock), 'job-start carries ticket.ticketId');
  assert(/sceneHash:\s*ticket\.sceneHash/.test(jobStartBlock), 'job-start carries ticket.sceneHash');
  // The append must be AFTER setUnsafePriorState (commitment point)
  // and BEFORE the try-block that starts executeJob. The commitment
  // ordering matters: if we wrote job-start before setUnsafePriorState,
  // a crash between the two would leave a ledger entry without the
  // recovery flag.
  const setUnsafeIdx = startMethod.indexOf('setUnsafePriorState(');
  const tryIdx = startMethod.indexOf('try {\n      this.jobObservedRunning');
  assert(
    setUnsafeIdx > 0
    && jobStartIdx > 0
    && tryIdx > 0
    && setUnsafeIdx < jobStartIdx
    && jobStartIdx < tryIdx,
    'job-start append sits between setUnsafePriorState and the streaming try block',
  );
}

// 2. tryFinalizeJobLog appends all three terminal events.
{
  const finalizeIdx = svcSrc.indexOf('async tryFinalizeJobLog(');
  const finalizeMethod = svcSrc.slice(finalizeIdx, finalizeIdx + 5000);
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'job-completed'/.test(finalizeMethod),
    'tryFinalizeJobLog appends job-completed in the completed branch',
  );
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'job-failed'/.test(finalizeMethod),
    'tryFinalizeJobLog appends job-failed in the failed branch',
  );
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'job-stopped'/.test(finalizeMethod),
    'tryFinalizeJobLog appends job-stopped in the stopped branch',
  );

  // Payload shape: job-completed carries linesAcknowledged,
  // job-failed carries error, job-stopped carries reason.
  const completedIdx = finalizeMethod.indexOf("kind: 'job-completed'");
  const completedBlock = finalizeMethod.slice(completedIdx, completedIdx + 400);
  assert(
    /linesAcknowledged:\s*linesCompleted/.test(completedBlock),
    'job-completed carries linesAcknowledged: linesCompleted',
  );

  const failedIdx = finalizeMethod.indexOf("kind: 'job-failed'");
  const failedBlock = finalizeMethod.slice(failedIdx, failedIdx + 400);
  assert(/error:/.test(failedBlock), 'job-failed carries error field');

  const stoppedIdx = finalizeMethod.indexOf("kind: 'job-stopped'");
  const stoppedBlock = finalizeMethod.slice(stoppedIdx, stoppedIdx + 400);
  assert(/reason:/.test(stoppedBlock), 'job-stopped carries reason field');

  // The appends must precede finalizeLog so the ledger entry exists
  // even if log finalization throws.
  const finalizeLogIdx = finalizeMethod.indexOf('finalizeLog(log, status, linesCompleted)');
  assert(
    completedIdx > 0 && finalizeLogIdx > 0 && completedIdx < finalizeLogIdx,
    'job-completed append precedes finalizeLog',
  );
  assert(
    failedIdx > 0 && finalizeLogIdx > 0 && failedIdx < finalizeLogIdx,
    'job-failed append precedes finalizeLog',
  );
  assert(
    stoppedIdx > 0 && finalizeLogIdx > 0 && stoppedIdx < finalizeLogIdx,
    'job-stopped append precedes finalizeLog',
  );
}

// 3. Total ledger appends in MachineService.ts now includes the
//    pre-T1-199 4 sites + the new 4 sites (1 job-start + 3 terminal
//    branches) = 8.
{
  const appendCount = (svcSrc.match(/getMachineEventLedger\(\)\.append\(/g) ?? []).length;
  assert(appendCount >= 8, `MachineService appends to the ledger ≥8 times (got ${appendCount})`);
}

// 4. The MachineEvent union still declares the four `job-*` kinds
//    (regression bait — a refactor that removed one of them would
//    silently break T1-199).
{
  const ledgerSrc = readFileSync(resolve(here, '../src/app/MachineEventLedger.ts'), 'utf-8');
  assert(/kind:\s*'job-start'/.test(ledgerSrc), "MachineEvent declares 'job-start'");
  assert(/kind:\s*'job-completed'/.test(ledgerSrc), "MachineEvent declares 'job-completed'");
  assert(/kind:\s*'job-stopped'/.test(ledgerSrc), "MachineEvent declares 'job-stopped'");
  assert(/kind:\s*'job-failed'/.test(ledgerSrc), "MachineEvent declares 'job-failed'");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
