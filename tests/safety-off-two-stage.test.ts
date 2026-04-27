/**
 * T1-22 regression test: GrblController.safetyOff() two-stage hardware-off path.
 *
 * Bug: SerialPortLike.write/writeByte are fire-and-forget; transport failures
 * (USB suspend, cable glitch) are swallowed via _errorCallback. The previous
 * emergencyLaserOff path used sendCommand → write, so the deadman M5 (T1-18)
 * could silently never reach firmware. Audit 1A.
 *
 * Audit 1C: M5 is not a GRBL realtime byte — it's planner-buffered. Soft
 * reset (0x18) is the actual realtime emergency stop. T1-22 introduces a
 * two-stage path: try M5 via writeCritical first, fall back to soft reset
 * if M5's transport rejects.
 *
 * This test exercises GrblController.safetyOff() directly with a
 * MockSerialPort that supports per-call fail injection. Asserts:
 *   - Happy path (M5 succeeds via writeCritical) → { stage: 'm5' }.
 *   - M5 fails → soft reset succeeds → { stage: 'soft-reset', error }.
 *   - M5 fails → soft reset also fails → { stage: 'failed' }.
 *   - Port not open → { stage: 'failed', error: 'Not connected' }, no writes.
 *   - Soft-reset fallback also calls _abortJob (isJobRunning flips false).
 *
 * Run: npx tsx tests/safety-off-two-stage.test.ts
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
  console.log('\n=== safety-off two-stage (T1-22) ===\n');

  // ── 1. Happy path: M5 via writeCritical succeeds ───────────────────────
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    const result = await ctrl.safetyOff();
    assert(result.stage === 'm5', "happy path: stage === 'm5'");
    assert(result.error === undefined, 'happy path: no error');
    assert(port.received.includes('M5 S0'), 'happy path: M5 S0 in port.received');
    assert(
      !port.realtimeBytes.includes(0x18),
      'happy path: no soft reset (0x18) sent',
    );
  }

  // ── 2. M5 transport fails → soft reset succeeds ────────────────────────
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    port.failNextCriticalWrite = true; // M5 writeCritical will reject
    const result = await ctrl.safetyOff();

    assert(result.stage === 'soft-reset', "M5-fail path: stage === 'soft-reset'");
    assert(
      result.error?.message.includes('Simulated transport failure') ?? false,
      'M5-fail path: error captures the M5-side failure reason',
    );
    assert(
      port.realtimeBytes.includes(0x18),
      'M5-fail path: soft reset (0x18) was sent as fallback',
    );
  }

  // ── 3. Both M5 and soft reset fail ─────────────────────────────────────
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    port.failAllCriticalWrites = true;
    const result = await ctrl.safetyOff();

    assert(result.stage === 'failed', "both-fail path: stage === 'failed'");
    assert(
      (result.error?.message.includes('M5 failed') ?? false)
      && (result.error?.message.includes('soft reset also failed') ?? false),
      'both-fail path: combined error message captures both failures',
    );
  }

  // ── 4. Port not open → returns failed without attempting writes ────────
  {
    const port = new MockSerialPort();
    // Note: do NOT open the port.
    const ctrl = new GrblController();
    // connect() will fail because port isn't open; just attach the port directly
    // by going through connect-then-close to put controller in disconnected state.
    port.open();
    await ctrl.connect(port);
    await flush();
    port.close();

    const result = await ctrl.safetyOff();
    assert(result.stage === 'failed', "closed port: stage === 'failed'");
    assert(
      result.error?.message === 'Not connected',
      "closed port: error message === 'Not connected'",
    );
    assert(
      !port.received.some(line => line === 'M5 S0'),
      'closed port: no M5 attempted',
    );
  }

  // ── 5. Soft-reset fallback also aborts the in-flight job state ─────────
  {
    const port = new MockSerialPort();
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush();

    // Fake an in-flight job by sending a small one. We don't await the full
    // run — we only need _isJobRunning to flip true so we can verify the
    // soft-reset path's abortJob clears it.
    void ctrl.sendJob(['G1 X10 F1000']);
    // sendJob is async; give it a microtask tick so internal state moves.
    await flush(5);

    port.failNextCriticalWrite = true;
    const result = await ctrl.safetyOff();
    assert(result.stage === 'soft-reset', 'in-flight + M5-fail: takes soft-reset fallback');
    // Abort sets _isJobRunning false. We can't read the private; verify via
    // the public isJobRunning getter.
    assert(
      ctrl.isJobRunning === false,
      'soft-reset fallback: isJobRunning cleared (abortJob ran)',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
