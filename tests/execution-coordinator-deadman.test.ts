/**
 * T1-18 regression test: ExecutionCoordinator owns the test-fire deadman timer.
 *
 * Bug: the deadman setTimeout that auto-stops a held test-fire lived in
 * ConnectionPanelMain.tsx (UI). A renderer pause, lost pointer-capture, hot
 * reload, or component unmount could strand the laser on. The
 * ExecutionCoordinator's beginTestFire even documented this with
 * "Caller must ... set up a deadman timer — this method does NOT auto-stop."
 *
 * Fix: the deadman is now armed inside ExecutionCoordinator.beginTestFire
 * synchronously after the laser-on command succeeds, and disarmed in endTestFire before the
 * M5 is issued. UI pointer-up / pointer-cancel / unmount paths still call
 * endTestFire for UX, but the safety guarantee no longer depends on the UI.
 *
 * Run: npx tsx tests/execution-coordinator-deadman.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

interface SentLog { sent: string[]; sim: string[] }

function makeMockController(sent: string[], throwOnSend = false): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: (cmd: string) => {
      if (throwOnSend) throw new Error('blocked');
      sent.push(cmd);
    },
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    operations: {
      jog: async () => ({ ok: true as const }),
      home: async () => ({ ok: true as const }),
      unlockAlarm: async () => ({ ok: true as const }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
      resetWcsToMachineOrigin: async () => ({ ok: true as const }),
      testFire: async (args: { powerPercent: number; maxSpindle: number }) => {
        if (throwOnSend) return { ok: false as const, reason: 'blocked', message: 'blocked' };
        sent.push(`M3 S${Math.max(0, Math.round((args.powerPercent / 100) * args.maxSpindle))}`);
        return { ok: true as const };
      },
      laserOff: async () => {
        sent.push('M5 S0');
        return { ok: true as const };
      },
      pauseJob: async () => ({ ok: true as const }),
      resumeJob: async () => ({ ok: true as const }),
      stopJob: async () => ({ ok: true as const }),
      emergencyStop: async () => ({ ok: true as const }),
    },
    safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
  } as unknown as LaserController;
}

function makeCoord(
  controller: LaserController | null,
  log: SentLog,
  testFireDeadmanMs?: number,
): ExecutionCoordinator {
  const controllerRef = { current: controller } as { current: LaserController | null };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(
    controllerRef as { current: LaserController },
    portRef,
  );
  const notifyRef = { current: (line: string) => { log.sim.push(line); } };
  return new ExecutionCoordinator({
    machineService: svc,
    controllerRef,
    notifySimulatorRef: notifyRef,
    testFireDeadmanMs,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

void (async () => {
  console.log('\n=== execution-coordinator deadman (T1-18) ===\n');

  // ── 1. Arms on success: timer fires M5 without any user action ─────────
  {
    const log: SentLog = { sent: [], sim: [] };
    const coord = makeCoord(makeMockController(log.sent), log, 50);

    const ok = await coord.beginTestFire({ maxSpindle: 1000 });
    assert(ok === true, 'beginTestFire returns true on success');
    assert(log.sent.includes('M3 S50'), 'M3 S50 sent');
    assert(!log.sent.includes('M5 S0'), 'no M5 yet (timer pending)');

    // Wait past the 50ms deadman + a margin for setTimeout drift.
    await wait(120);

    assert(log.sent.includes('M5 S0'), 'deadman fired: M5 S0 emitted automatically');
    assert(
      log.sent.filter(c => c === 'M5 S0').length === 1,
      'exactly one M5 from the deadman',
    );
  }

  // ── 2. Disarms on endTestFire: timer does NOT also fire M5 ─────────────
  {
    const log: SentLog = { sent: [], sim: [] };
    const coord = makeCoord(makeMockController(log.sent), log, 50);

    await coord.beginTestFire({ maxSpindle: 1000 });
    await coord.endTestFire();

    const m5CountAfterExplicit = log.sent.filter(c => c === 'M5 S0').length;
    assert(m5CountAfterExplicit === 1, 'endTestFire issues exactly one M5');

    // Now wait past the original deadman expiry. The timer must have been
    // cleared, so no second M5 should appear.
    await wait(120);

    const m5CountAfterDeadlineWait = log.sent.filter(c => c === 'M5 S0').length;
    assert(
      m5CountAfterDeadlineWait === 1,
      'endTestFire disarmed the timer — no second M5 from deadman',
    );
  }

  // ── 3. Does NOT arm if beginTestFire failed (operation rejected) ───────
  {
    const log: SentLog = { sent: [], sim: [] };
    const coord = makeCoord(makeMockController(log.sent, true), log, 50);

    const ok = await coord.beginTestFire({ maxSpindle: 1000 });
    assert(ok === false, 'beginTestFire returns false when operations.testFire rejects');

    // No timer should have been armed. Wait past where the deadman would have
    // fired and assert no M5 was issued from the service.
    await wait(120);

    assert(
      !log.sent.includes('M5 S0'),
      'no deadman M5 when beginTestFire failed',
    );
  }

  // ── 4. Does NOT arm if there is no controller ──────────────────────────
  {
    const log: SentLog = { sent: [], sim: [] };
    const coord = makeCoord(null, log, 50);

    const ok = await coord.beginTestFire({ maxSpindle: 1000 });
    assert(ok === false, 'no controller → beginTestFire false');

    await wait(120);

    assert(log.sim.length === 0, 'no controller → no simulator notify from deadman');
  }

  // ── 5. Re-entry resets the timer (only second beginTestFire's expiry fires) ─
  {
    const log: SentLog = { sent: [], sim: [] };
    const coord = makeCoord(makeMockController(log.sent), log, 80);

    await coord.beginTestFire({ maxSpindle: 1000 });

    // After 50ms (before the first deadman expires), call begin again.
    // The first timer must be cleared — only the second timer's expiry should fire.
    await wait(50);
    await coord.beginTestFire({ maxSpindle: 1000 });

    // At t=70ms, the first timer would have fired (80ms from t=0). Verify M5 not
    // yet sent — proves the first timer was cleared on re-entry.
    await wait(20);
    assert(
      log.sent.filter(c => c === 'M5 S0').length === 0,
      're-entry cleared the first deadman (no early M5)',
    );

    // The second timer was armed at t=50 with 80ms duration → expires at t=130.
    // Wait until t≈150ms total to confirm exactly one M5 from the second timer.
    await wait(80);
    assert(
      log.sent.filter(c => c === 'M5 S0').length === 1,
      'second deadman fired exactly once',
    );
  }

  // ── 6. endTestFire is idempotent: safe to call without an active fire ──
  {
    const log: SentLog = { sent: [], sim: [] };
    const coord = makeCoord(makeMockController(log.sent), log, 50);

    // No prior beginTestFire — endTestFire should still be safe.
    await coord.endTestFire();
    assert(
      log.sent.filter(c => c === 'M5 S0').length === 1,
      'endTestFire without an active fire still issues M5 (idempotent)',
    );

    // And calling it again is also safe.
    await coord.endTestFire();
    assert(
      log.sent.filter(c => c === 'M5 S0').length === 2,
      'endTestFire called twice → two explicit M5s, no errors',
    );

    await wait(120);
    assert(
      log.sent.filter(c => c === 'M5 S0').length === 2,
      'no extra deadman M5 fires after explicit stops',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
