/**
 * T1-24 + T2-12 part 2 regression test: GRBL error/alarm handlers
 * actively command the laser off; active-job errors transition to
 * a halt-state (not 'idle'); hardware-reported alarm tokens still
 * map to 'alarm' (T2-12 regression guard).
 *
 * Background — error path:
 *   GRBL `error:N` does NOT necessarily disable the laser. It's a parsing
 *   or protocol-level error and modal M3/M4 state can persist while the
 *   beam keeps burning. Pre-T1-24, _handleError aborted the job and
 *   transitioned to 'idle' — which the UI reads as "ready for next job."
 *   A user who ignored the error and clicked Run again would start a new
 *   job from a state where the previous error left the laser potentially
 *   still on, in unknown position. Audit 1E identified this as a top
 *   safety failure.
 *
 * Background — alarm path:
 *   GRBL ALARM:N triggers firmware-side spindle/laser disable per spec,
 *   but that's a firmware-side promise without software-side proof. If
 *   the alarm condition itself was caused by a firmware bug, USB glitch,
 *   or partial reset, the laser can be in an undefined state. Pre-T1-24,
 *   _handleAlarm aborted the job without commanding the laser off.
 *
 * Fix (T1-24):
 *   1. _handleError: fire safetyOff() (T1-22's two-stage M5 → soft-reset
 *      path) when a job was active at handler entry. Skip safety-off if
 *      no job was running — protocol errors with no laser activity don't
 *      need it and the noise on the connect handshake (mock port returns
 *      error:20 to the wake-up '\n' line) would mask real issues.
 *   2. _handleError: when _stopOnError is true, transition to a halt-
 *      state (instead of 'idle') if a job was active. UI gates Run on
 *      halt-states, forcing the user to consciously clear.
 *      For idle errors (e.g. user typed an invalid console command), the
 *      previous status was already 'idle' and there's no laser motion to
 *      lock down — preserve the existing 'idle' transition.
 *   3. _handleAlarm: fire safetyOff() unconditionally (defense-in-depth).
 *
 * Update (T2-12 part 2):
 *   The active-job halt-state is now 'faulted_requires_inspection',
 *   not 'alarm'. Hardware-reported ALARM tokens continue to map to
 *   'alarm'. Two states with subtly different semantics — 'alarm' is
 *   firmware-reported and cleared via $X; 'faulted_requires_inspection'
 *   is software-synthesized and cleared via acknowledgeFault() after the
 *   user inspects the machine.
 *
 * What this test enforces:
 *   1. Error during active job → safetyOff fires (soft reset 0x18 lands
 *      in port.realtimeBytes via the safetyOff fallback path, since M5
 *      via writeCritical may complete fast enough to short-circuit before
 *      we observe).
 *   2. Error during active job + _stopOnError → status becomes
 *      'faulted_requires_inspection', not 'idle' or 'alarm'. errorCode
 *      preserved.
 *   3. Error while idle (no active job) → does NOT fire safetyOff.
 *      Verified by checking that the realtime bytes contain only the
 *      connect-handshake bytes (`?` for status poll, no 0x18).
 *   4. ALARM:N (hardware-reported) → fires safetyOff regardless of job
 *      state. Status transitions to 'alarm' — explicitly NOT to the
 *      faulted state. This is the T2-12 part 2 regression guard for
 *      the two-state distinction.
 *
 * Run: npx tsx tests/error-handler-sends-safety-off.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function flush(ms = 15): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

void (async () => {
  console.log('\n=== error/alarm handlers send safety-off (T1-24) ===\n');

  // ── 1. Error during active job → safetyOff fires (soft-reset) ─────────
  // We use port.failNextCriticalWrite to force the soft-reset fallback,
  // because that's observable via realtimeBytes. The M5 success path is
  // observable via port.received but harder to time-distinguish from
  // earlier M5s in the connect handshake.
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    // Start an in-flight job. Don't await — we only need _isJobRunning
    // to flip true.
    void ctrl.sendJob(['G1 X10 F1000']);
    await flush(5);
    assert(ctrl.isJobRunning === true, 'sanity: job is running before error');

    // Force safetyOff's M5 stage to fail so we observe the 0x18 fallback.
    port.failNextCriticalWrite = true;

    const realtimeBefore = port.realtimeBytes.length;
    // Inject an error response. _handleError fires; safetyOff is fired
    // (fire-and-forget); the soft-reset fallback writes 0x18.
    port.injectResponse('error:5');

    // safetyOff is async; give it time to resolve through both stages.
    await flush(50);

    const newRealtimeBytes = port.realtimeBytes.slice(realtimeBefore);
    assert(
      newRealtimeBytes.includes(0x18),
      `active-job error → safetyOff fallback wrote soft-reset byte 0x18 (got bytes: ${JSON.stringify(newRealtimeBytes)})`,
    );
  }

  // ── 2. Error during active job → status='faulted_requires_inspection' ──
  // T1-24 originally moved this to 'alarm'; T2-12 part 2 promotes the
  // active-job error transition to a software-distinct state so the UI
  // can offer the right recovery action ("acknowledge fault" rather
  // than "$X to clear alarm"). Block 4 below verifies that hardware-
  // reported ALARM tokens still map to 'alarm' — the regression guard
  // for the two-state distinction.
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    void ctrl.sendJob(['G1 X10 F1000']);
    await flush(5);
    assert(ctrl.isJobRunning === true, 'sanity: job is running');
    assert(ctrl.state.status !== 'idle', 'sanity: status not idle while job active');

    port.injectResponse('error:9');
    await flush(50);

    assert(
      ctrl.state.status === 'faulted_requires_inspection',
      `error during active job → status='faulted_requires_inspection' (got "${ctrl.state.status}")`,
    );
    assert(
      ctrl.state.errorCode === 9,
      `error during active job → errorCode preserved (got ${ctrl.state.errorCode})`,
    );
    assert(
      ctrl.isJobRunning === false,
      'error during active job → isJobRunning cleared (abortJob ran)',
    );
  }

  // ── 3. Error while idle → does NOT fire safetyOff ──────────────────────
  // The connect handshake fires its own M5 via the WCS-normalize path on
  // mock — we don't want to false-positive that as T1-24 behavior. Track
  // realtimeBytes from the snapshot taken right before injecting the
  // error.
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    assert(ctrl.isJobRunning === false, 'sanity: no active job');
    assert(ctrl.state.status !== 'run', 'sanity: not in run state');

    const realtimeBefore = port.realtimeBytes.length;
    port.injectResponse('error:20');
    await flush(50);

    const newBytes = port.realtimeBytes.slice(realtimeBefore);
    assert(
      !newBytes.includes(0x18),
      `idle error → safetyOff NOT fired (no 0x18 in realtime bytes; got: ${JSON.stringify(newBytes)})`,
    );
    assert(
      ctrl.state.status === 'idle',
      `idle error → status remains 'idle' (got "${ctrl.state.status}")`,
    );
  }

  // ── 4. ALARM:N → fires safetyOff regardless ───────────────────────────
  // Alarm path is unconditional. We don't gate on wasJobRunning because
  // the GRBL spec says alarm disables laser, but that's a firmware
  // promise. safetyOff is the software-side belt-and-suspenders.
  // We check via the soft-reset fallback path again.
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    port.failNextCriticalWrite = true;

    const realtimeBefore = port.realtimeBytes.length;
    port.injectResponse('ALARM:1');
    await flush(50);

    const newBytes = port.realtimeBytes.slice(realtimeBefore);
    assert(
      newBytes.includes(0x18),
      `ALARM → safetyOff fallback wrote soft-reset byte 0x18 (got bytes: ${JSON.stringify(newBytes)})`,
    );
    assert(
      ctrl.state.status === 'alarm',
      `ALARM → status transitions to 'alarm' (got "${ctrl.state.status}")`,
    );
    assert(
      ctrl.state.alarmCode === 1,
      `ALARM → alarmCode preserved (got ${ctrl.state.alarmCode})`,
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
