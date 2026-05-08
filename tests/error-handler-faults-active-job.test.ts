/**
 * T2-12 part 2 regression test: GrblController._handleError transitions
 * to 'faulted_requires_inspection' (not 'alarm') for active-job errors,
 * preserves 'idle' for idle errors, and acknowledgeFault returns the
 * controller cleanly to 'idle'.
 *
 * Complements (does not replace) error-handler-sends-safety-off.test.ts,
 * which covers the T1-24 safetyOff plumbing and now also asserts the
 * new state name. This file zooms in specifically on the state machine:
 *   - which handler produces which status under which condition,
 *   - that hardware-reported ALARM tokens still map to 'alarm' (not
 *     faulted) — the regression guard for the two-state distinction,
 *   - that acknowledgeFault is idempotent and bounded.
 *
 * Hardware never reports 'faulted_requires_inspection' as a token; the
 * state is software-synthesized only. Conversely, the controller never
 * synthesizes 'alarm' from a software path. This test enforces both
 * directions.
 *
 * Run: npx tsx tests/error-handler-faults-active-job.test.ts
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
  console.log('\n=== T2-12 part 2: faulted_requires_inspection state machine ===\n');

  // ── 1. Active-job error → status='faulted_requires_inspection' ─────────
  console.log('-- 1. active-job error transitions to faulted --');
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    void ctrl.sendJob(['G1 X10 F1000']);
    await flush(5);
    assert(ctrl.isJobRunning === true, 'sanity: job is running');

    port.injectResponse('error:9');
    await flush(50);

    assert(
      ctrl.state.status === 'faulted_requires_inspection',
      `active-job error → status='faulted_requires_inspection' (got "${ctrl.state.status}")`,
    );
    assert(
      ctrl.state.status !== 'alarm',
      'active-job error → status is NOT "alarm" (T2-12 part 2 distinction)',
    );
    assert(ctrl.isJobRunning === false, 'active-job error → isJobRunning false');
    assert(ctrl.state.errorCode === 9, 'active-job error → errorCode preserved');
  }

  // ── 2. Idle error → status stays 'idle' ───────────────────────────────
  console.log('\n-- 2. idle error preserves idle (no fault) --');
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    assert(ctrl.isJobRunning === false, 'sanity: no job running');

    // Send a user command that the mock will respond to with error.
    ctrl.sendCommand('$bogus', 'user');
    port.injectResponse('error:1');
    await flush(50);

    assert(
      ctrl.state.errorCode === null,
      `idle error does not latch errorCode as a frame/start safety hold (got ${ctrl.state.errorCode})`,
    );
    assert(
      ctrl.state.status !== 'faulted_requires_inspection',
      'idle error → status is NOT faulted (no job to fault on)',
    );
    assert(
      ctrl.state.status === 'idle',
      `idle error → status remains 'idle' (got "${ctrl.state.status}")`,
    );
  }

  // ── 3. Hardware ALARM:N token → status='alarm' (regression guard) ────
  console.log('\n-- 3. hardware ALARM token still maps to alarm --');
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    port.injectResponse('ALARM:1');
    await flush(50);

    assert(
      ctrl.state.status === 'alarm',
      `hardware ALARM token → status='alarm' (got "${ctrl.state.status}")`,
    );
    assert(
      ctrl.state.status !== 'faulted_requires_inspection',
      'hardware ALARM → status is NOT faulted (regression guard for two-state distinction)',
    );
    assert(ctrl.state.alarmCode === 1, 'hardware ALARM → alarmCode preserved');
  }

  // ── 4. acknowledgeFault from faulted state → returns to 'idle' ──────
  console.log('\n-- 4. acknowledgeFault transitions faulted → idle --');
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    // Drive the controller into faulted state.
    void ctrl.sendJob(['G1 X10 F1000']);
    await flush(5);
    port.injectResponse('error:9');
    await flush(50);
    assert(
      ctrl.state.status === 'faulted_requires_inspection',
      'precondition: in faulted state',
    );

    // Acknowledge.
    if (!ctrl.acknowledgeFault) {
      assert(false, 'acknowledgeFault method exists on GrblController');
      return;
    }
    const result = await ctrl.acknowledgeFault();
    await flush(20); // give safetyOff fire-and-forget a tick
    assert(result.ok === true, 'acknowledgeFault returned { ok: true }');
    assert(
      ctrl.state.status === 'idle',
      `acknowledgeFault → status='idle' (got "${ctrl.state.status}")`,
    );
    assert(
      ctrl.state.errorCode === null,
      'acknowledgeFault → errorCode cleared',
    );
  }

  // ── 5. acknowledgeFault from non-faulted state → idempotent no-op ───
  console.log('\n-- 5. acknowledgeFault is idempotent from non-faulted --');
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    assert(ctrl.state.status === 'idle', 'precondition: idle state');

    if (!ctrl.acknowledgeFault) {
      assert(false, 'acknowledgeFault method exists on GrblController');
      return;
    }
    const result = await ctrl.acknowledgeFault();
    assert(result.ok === true, 'acknowledgeFault from idle → { ok: true } (no-op)');
    assert(
      ctrl.state.status === 'idle',
      'acknowledgeFault from idle → status unchanged',
    );

    // Drive to alarm (hardware token), confirm acknowledgeFault is a no-op
    // there too — alarm is cleared by $X, not by acknowledgeFault.
    port.injectResponse('ALARM:1');
    await flush(50);
    assert(ctrl.state.status === 'alarm', 'precondition: alarm state');

    const result2 = await ctrl.acknowledgeFault();
    assert(result2.ok === true, 'acknowledgeFault from alarm → { ok: true } (no-op)');
    assert(
      ctrl.state.status === 'alarm',
      'acknowledgeFault from alarm → status unchanged (alarm is not faulted)',
    );
  }

  // ── 6. acknowledgeFault when disconnected → returns ok:false ─────────
  console.log('\n-- 6. acknowledgeFault when disconnected fails cleanly --');
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();
    await ctrl.disconnect();

    if (!ctrl.acknowledgeFault) {
      assert(false, 'acknowledgeFault method exists on GrblController');
      return;
    }
    const result = await ctrl.acknowledgeFault();
    assert(result.ok === false, 'disconnected → { ok: false }');
    assert(typeof result.reason === 'string', 'disconnected → reason string present');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
