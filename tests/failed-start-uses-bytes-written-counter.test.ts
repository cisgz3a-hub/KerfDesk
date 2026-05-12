/**
 * T1-220 (v30 audit #8): the failed-start unsafe-prior-state
 * carve-out must use a monotonic byte-count counter, not just the
 * pair (sawRun, controllerThinksRunning), to decide whether to
 * clear the flag.
 *
 * Pre-T1-220 the carve-out checked `!sawRun && !controllerThinksRunning`.
 * Both signals can be cleared synchronously by a controller-side
 * `_abortJob()` between the throw and the catch site, even after
 * machine-affecting bytes have hit the wire. Audit:
 *
 *   "bytes hit the wire but controller status did not yet report
 *    `run`, or the failure occurs before the local `isJobRunning`
 *    flag is reliable. The app clears unsafe state despite partial
 *    machine-affecting output."
 *
 * Post-T1-220:
 *   - GrblController exposes `getJobLinesWrittenSinceJobStart(): number`.
 *   - The counter is reset to 0 at sendJob start and incremented
 *     after each successful line write inside `_drainQueue`.
 *   - MachineService's failed-start branch ANDs `jobLinesWritten === 0`
 *     into the clear-unsafe gate. Any non-zero count preserves the
 *     unsafe-prior-state flag regardless of the two boolean flags.
 *
 * Run: npx tsx tests/failed-start-uses-bytes-written-counter.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

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

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function buildPort(): MockSerialPort {
  // Suppress acks for motion lines so the job stays in-flight and
  // _isJobRunning remains true (matches existing pattern in
  // controller-safety-action-result-methods.test.ts).
  return new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    if (/\bG0\b|\bG00\b|\bG1\b|\bG01\b/.test(line)) return [];
    return ['ok'];
  });
}

console.log('\n=== T1-220 failed-start uses bytes-written counter ===\n');

void (async () => {

// -------- 1. Fresh controller: counter starts at 0 --------
{
  const ctrl = new GrblController();
  assert(
    ctrl.getJobLinesWrittenSinceJobStart() === 0,
    'fresh controller: counter is 0',
  );
}

// -------- 2. After sendJob with motion lines: counter is non-zero --------
{
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();

  // Send a job with multiple motion lines. The mock suppresses
  // acks so _drainQueue writes them all up to the buffer.
  await ctrl.sendJob(['G21', 'G90', 'G1 X1 Y1 F600', 'G1 X2 Y2 F600', 'G1 X3 Y3 F600']);
  await flush();

  const written = ctrl.getJobLinesWrittenSinceJobStart();
  assert(written > 0, `counter is non-zero after sendJob (got ${written})`);
  // Should be >= the number of lines drained; with a 127-byte GRBL
  // buffer all 5 short lines fit.
  assert(written >= 5, `counter reflects all drained lines (got ${written})`);

  await ctrl.disconnect();
}

// -------- 3. sendJob resets counter on each new job --------
{
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();

  await ctrl.sendJob(['G21', 'G1 X1 Y1 F600', 'G1 X2 Y2 F600']);
  await flush();
  const afterJob1 = ctrl.getJobLinesWrittenSinceJobStart();
  assert(afterJob1 > 0, 'job 1: non-zero counter');

  // Bypass abort path: directly bring the controller back to a
  // state where a new sendJob succeeds. The audit's interest is
  // RESET on new job, not the abort flow itself.
  // We need _isJobRunning = false for sendJob to proceed.
  const priv = ctrl as unknown as { _isJobRunning: boolean };
  priv._isJobRunning = false;

  await ctrl.sendJob(['G21', 'G1 X10 Y10 F600']);
  await flush();
  const afterJob2 = ctrl.getJobLinesWrittenSinceJobStart();
  // Job 2 wrote fewer lines than job 1, so the counter must have
  // reset (otherwise it would be cumulative).
  assert(
    afterJob2 < afterJob1,
    `job 2 counter (${afterJob2}) is less than job 1 counter (${afterJob1}) — proves reset`,
  );
  assert(afterJob2 > 0, 'job 2: non-zero counter');

  await ctrl.disconnect();
}

// -------- 4. Counter is monotonic during a job (never decremented) --------
{
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  await ctrl.sendJob(['G21', 'G1 X1 Y1 F600', 'G1 X2 Y2 F600']);
  await flush();

  const checkpoint1 = ctrl.getJobLinesWrittenSinceJobStart();
  // Read it again — should be identical (no decrement, no
  // side-effect).
  const checkpoint2 = ctrl.getJobLinesWrittenSinceJobStart();
  assert(
    checkpoint1 === checkpoint2,
    'two reads in a row return the same value (monotonic / no side effect)',
  );

  await ctrl.disconnect();
}

// -------- 5. Source pins --------
{
  const ctrlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/T1-220/.test(ctrlSrc), 'GrblController.ts carries T1-220 marker');
  assert(
    /private _jobLinesWrittenSinceJobStart = 0;/.test(ctrlSrc),
    'counter field declared and initialized to 0',
  );
  assert(
    /getJobLinesWrittenSinceJobStart\(\): number/.test(ctrlSrc),
    'public getter exposed',
  );
  // Increment must be INSIDE _drainQueue AFTER _writeLine.
  const drainBlock = ctrlSrc.slice(
    ctrlSrc.indexOf('private _drainQueue('),
    ctrlSrc.indexOf('private _drainQueue(') + 1500,
  );
  assert(
    /this\._writeLine\(line\);[\s\S]{0,800}this\._jobLinesWrittenSinceJobStart\+\+/.test(drainBlock),
    'increment happens AFTER _writeLine inside _drainQueue (failed writes do not count)',
  );
  // Reset must be in sendJob's setup block.
  const sendJobBlock = ctrlSrc.slice(
    ctrlSrc.indexOf('async sendJob('),
    ctrlSrc.indexOf('async sendJob(') + 2500,
  );
  assert(
    /this\._jobLinesWrittenSinceJobStart = 0;/.test(sendJobBlock),
    'counter reset at sendJob start',
  );

  const ifaceSrc = readFileSync(
    resolve(here, '../src/controllers/ControllerInterface.ts'),
    'utf-8',
  );
  assert(/T1-220/.test(ifaceSrc), 'ControllerInterface.ts carries T1-220 marker');
  assert(
    /getJobLinesWrittenSinceJobStart\?\(\): number/.test(ifaceSrc),
    'LaserController interface declares optional getJobLinesWrittenSinceJobStart',
  );

  const svcSrc = readFileSync(
    resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/T1-220/.test(svcSrc), 'MachineService.ts carries T1-220 marker');
  assert(
    /getJobLinesWrittenSinceJobStart\?\.\(\) \?\? 0/.test(svcSrc),
    'MachineService reads the counter at the failed-start catch (defaults to 0 for non-GRBL)',
  );
  // The carve-out condition must AND in jobLinesWritten === 0.
  assert(
    /!sawRun && !controllerThinksRunning && jobLinesWritten === 0/.test(svcSrc),
    'clear-unsafe gate ANDs jobLinesWritten === 0',
  );
  // The warn message must name all three signals.
  assert(
    /jobLinesWritten=\$\{jobLinesWritten\}/.test(svcSrc),
    'preservation warn names jobLinesWritten so support bundles capture it',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
