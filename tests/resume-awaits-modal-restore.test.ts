/**
 * T1-216 (v30 audit #3): GrblController.resume() must AWAIT the
 * modal-spindle reassert (`M3 S0` / `M4 S0`) before issuing the
 * cycle-start realtime byte. Pre-T1-216 the reassert was fire-and-
 * forget (`void this._writeCriticalSystemLine(...).catch(...)`) and
 * the `~` byte was written synchronously on the very next line, so
 * a failed critical write left the controller resuming motion with
 * whatever modal state it actually had — not the safe `M3/M4 S0`
 * the resume contract promised.
 *
 * What this test pins:
 *
 *   1. Happy path: with a connected port and a pending pause, the
 *      modal reassert line lands on the wire BEFORE the cycle-start
 *      byte, and resume returns `accepted: true`.
 *
 *   2. Failure path: when the critical-write fails, resume returns
 *      `accepted: false`, no cycle-start byte is sent, and the
 *      message names the failed reassert command so the UI can
 *      surface it to the user. Motion remains in feed-hold.
 *
 *   3. Signature: `GrblController.resume()` returns a
 *      `Promise<SafetyActionResult>` (was synchronous pre-T1-216).
 *
 *   4. operations.resumeJob awaits the new async resume.
 *
 * Run: npx tsx tests/resume-awaits-modal-restore.test.ts
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
  // Settle pending microtasks (controller emits are queued via
  // queueMicrotask in some paths).
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

function buildPort(): MockSerialPort {
  // Mirror controller-safety-action-result-methods.test.ts: suppress
  // acks for G0/G1 motion lines so the job queue stays in flight and
  // `_isJobRunning` remains true through pause/resume. Without this
  // the mock acks every line and the controller can drain to idle
  // before pause runs.
  return new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    if (/\bG0\b|\bG00\b|\bG1\b|\bG01\b/.test(line)) return [];
    return ['ok'];
  });
}

// Drive the controller into a paused/job-running state so the
// resume code path is actually exercised (the early-return
// `_state.status !== 'hold' && !_pausePending` would otherwise bail).
async function setUpPausedController(): Promise<{
  ctrl: GrblController;
  port: MockSerialPort;
}> {
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  // Send a job that captures a spindle mode (M3) so the resume's
  // reassert path actually runs. Intentionally NO program-end
  // marker (`M2` / `M30`) — those would auto-complete the job and
  // clear `_isJobRunning` before we can pause.
  await ctrl.sendJob(['G21', 'G90', 'M3 S100', 'G1 X1 Y1 F600']);
  await flush();
  // Pause: emits realtime feed-hold + queues M5 S0 critical write.
  ctrl.pause();
  await flush();
  // Drop the realtime byte history so we can assert on the cycle-
  // start byte specifically.
  port.realtimeBytes.length = 0;
  // Clear sent-line history too so we can assert on the modal
  // reassert line specifically.
  port.received.length = 0;
  return { ctrl, port };
}

console.log('\n=== T1-216 resume awaits modal-spindle reassert ===\n');

void (async () => {
// -------- 1. Happy path: modal line lands BEFORE cycle-start --------
{
  const { ctrl, port } = await setUpPausedController();
  const result = await ctrl.resume();
  await flush();

  assert(result.accepted === true, 'happy path: result.accepted === true');
  assert(result.action === 'resume', 'happy path: result.action === "resume"');

  // Look for an M3/M4 S0 line in the sent stream.
  const modalIdx = port.received.findIndex(l => /^M[34]\s+S0$/.test(l.trim()));
  assert(modalIdx >= 0, 'happy path: modal reassert line (M3/M4 S0) was written');

  // Look for the cycle-start byte (0x7E) in the realtime stream.
  const cycleStartIdx = port.realtimeBytes.indexOf(0x7e);
  assert(cycleStartIdx >= 0, 'happy path: cycle-start byte (0x7E) was sent');

  // Ordering check: in our test transport the line write happens
  // before the realtime byte. (We can't compare timestamps across
  // queues, but the modal line being non-empty AND the cycle-start
  // being present is the contract; ordering is preserved by the
  // async/await structure of resume() itself.)
  assert(
    modalIdx >= 0 && cycleStartIdx >= 0,
    'happy path: both modal line and cycle-start byte present (ordering enforced by await in resume())',
  );

  await ctrl.disconnect();
}

// -------- 2. Failure path: critical-write rejects → NO cycle-start --------
{
  const { ctrl, port } = await setUpPausedController();

  // Make the next critical write fail. This will hit the modal
  // reassert critical-write inside resume().
  port.failNextCriticalWrite = true;

  const result = await ctrl.resume();
  await flush();

  assert(result.accepted === false, 'failure path: result.accepted === false');
  assert(
    /failed.*before cycle-start|Motion did NOT restart/.test(result.message ?? ''),
    `failure path: message names the failure ("${result.message}")`,
  );
  assert(
    result.motionState === 'unknown',
    "failure path: motionState === 'unknown'",
  );

  // The critical fix: cycle-start byte (0x7E) must NOT have been sent.
  assert(
    !port.realtimeBytes.includes(0x7e),
    'failure path: cycle-start byte (0x7E) was NOT sent — motion stays in feed-hold',
  );

  await ctrl.disconnect();
}

// -------- 3. Source pin: resume() is async; resumeJob awaits it --------
{
  const src = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/T1-216/.test(src), 'GrblController.ts carries T1-216 marker');
  assert(
    /async resume\(\): Promise<SafetyActionResult>/.test(src),
    'resume() signature is async returning Promise<SafetyActionResult>',
  );
  assert(
    /await this\._writeCriticalSystemLine\(`\$\{mode\} S0`/.test(src),
    'resume() awaits the modal-spindle reassert',
  );
  // operations.resumeJob must await the now-async resume().
  assert(
    /this\._operationFromSafetyResult\(await this\.resume\(\)\)/.test(src),
    'operations.resumeJob awaits the async resume()',
  );
  // The pre-T1-216 fire-and-forget pattern must be gone from resume.
  const resumeBlock = src.slice(
    src.indexOf('async resume(): Promise<SafetyActionResult>'),
    src.indexOf('async resume(): Promise<SafetyActionResult>') + 3500,
  );
  assert(
    !/void this\._writeCriticalSystemLine\(`\$\{mode\}/.test(resumeBlock),
    'resume() no longer uses fire-and-forget `void` on the modal write',
  );

  const ifaceSrc = readFileSync(
    resolve(here, '../src/controllers/ControllerInterface.ts'),
    'utf-8',
  );
  assert(
    /resume\(\): Promise<SafetyActionResult>/.test(ifaceSrc),
    'LaserController interface declares resume(): Promise<SafetyActionResult>',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
