/**
 * T1-164 (audit F-011): `MachineService.disconnect` must route the
 * outcome of `ctrl.operations.laserOff()` through
 * `notifyLaserSafetyOutcome` so the safety-state machine sees the
 * attempt.
 *
 * Pre-T1-164:
 *
 *   try {
 *     await ctrl.operations.laserOff();
 *   } catch {
 *     // not connected, buffer full, or port already gone
 *   }
 *
 * Both success and failure outcomes were discarded. A transport-
 * failure laserOff during disconnect could not escalate
 * `_laserOutputState` to `'unknown'`; a successful M5 could not
 * downgrade an existing `'on'` / `'unknown'` to `'off'`.
 *
 * Post-T1-164:
 *
 *  1. Success (`ok: true`) → `notifyLaserSafetyOutcome('m5')` → laser
 *     state set to `'off'`.
 *  2. Failure with reason `'soft-reset'` → notify `'soft-reset'` →
 *     state set to `'unknown'` AND emergency-stop recovery triggered.
 *  3. Failure with reason `'failed'` and message NOT matching
 *     "Not connected" → notify `'failed'` → state set to `'unknown'`.
 *  4. Failure with message matching "Not connected" → swallowed (the
 *     audit explicitly allows this — controller never had a live port
 *     we could have left in a laser-on state).
 *
 * Run: npx tsx tests/disconnect-laser-off-routes-through-notify.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MachineService } from '../src/app/MachineService';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

type LaserOffResult =
  | { ok: true }
  | { ok: false; reason: string; message?: string };

function makeController(laserOffResult: LaserOffResult | (() => never)): {
  controller: LaserController;
  calls: { disconnect: number; laserOff: number };
} {
  const calls = { disconnect: 0, laserOff: 0 };
  const controller = {
    protocolName: 'mock',
    state: { ...idle },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {
      calls.disconnect++;
    },
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      laserOff: async () => {
        calls.laserOff++;
        if (typeof laserOffResult === 'function') laserOffResult();
        return laserOffResult as LaserOffResult;
      },
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
  return { controller, calls };
}

function makePortRef(): { current: SerialPortLike | null } {
  return { current: {} as SerialPortLike };
}

function laserStateOf(svc: MachineService): string {
  // The state is exposed via the read-only getter used by the runtime;
  // some tests read it via `_laserOutputState` (private), so we cast.
  return (svc as unknown as { _laserOutputState: string })._laserOutputState;
}

console.log('\n=== T1-164 disconnect laserOff routes through notifyLaserSafetyOutcome ===\n');

void (async () => {
  // -------- 1. Success path → notify('m5') → state 'off' --------
  {
    const { controller, calls } = makeController({ ok: true });
    const svc = new MachineService({ current: controller }, makePortRef());
    // Drive the service into an 'unknown' state first so the test
    // proves the success notify downgrades it back to 'off' rather
    // than relying on initial defaults.
    svc.notifyLaserSafetyOutcome('failed');
    assert(laserStateOf(svc) === 'unknown', 'precondition: laser state is unknown before disconnect');

    await svc.disconnect();
    assert(calls.laserOff === 1, 'success: disconnect calls operations.laserOff once');
    assert(calls.disconnect === 1, 'success: disconnect calls ctrl.disconnect once');
    assert(
      laserStateOf(svc) === 'off',
      `success: laser state is 'off' after disconnect (notify('m5') downgraded 'unknown' → 'off')`,
    );
  }

  // -------- 2. Failed path (transport error, not "Not connected") --------
  {
    const { controller } = makeController({ ok: false, reason: 'failed', message: 'port write timeout' });
    const svc = new MachineService({ current: controller }, makePortRef());
    assert(laserStateOf(svc) === 'off', 'precondition: laser state is off (default)');

    await svc.disconnect();
    assert(
      laserStateOf(svc) === 'unknown',
      `failed: laser state is 'unknown' after transport-failure laserOff during disconnect`,
    );
  }

  // -------- 3. Soft-reset path → notify('soft-reset') → state 'unknown' --------
  {
    const { controller } = makeController({ ok: false, reason: 'soft-reset', message: 'M5 transport failed; soft reset succeeded' });
    const svc = new MachineService({ current: controller }, makePortRef());

    await svc.disconnect();
    assert(
      laserStateOf(svc) === 'unknown',
      `soft-reset: laser state is 'unknown' after soft-reset fallback during disconnect`,
    );
  }

  // -------- 4. "Not connected" failure is safe to swallow --------
  {
    const { controller } = makeController({ ok: false, reason: 'failed', message: 'Not connected' });
    const svc = new MachineService({ current: controller }, makePortRef());
    assert(laserStateOf(svc) === 'off', 'precondition: laser state is off (default)');

    await svc.disconnect();
    assert(
      laserStateOf(svc) === 'off',
      `Not connected: laser state stays 'off' (audit-allowed swallow — controller never had a live port we could have left on)`,
    );
  }

  // -------- 5. Underlying laserOff throws → still notifies 'failed' unless message is "Not connected" --------
  {
    const { controller } = makeController(() => { throw new Error('port already gone'); });
    const svc = new MachineService({ current: controller }, makePortRef());

    await svc.disconnect();
    assert(
      laserStateOf(svc) === 'unknown',
      `thrown error (non-"Not connected") routes through notify('failed') and lands in 'unknown'`,
    );
  }

  // -------- 6. Underlying laserOff throws "Not connected" → swallow path --------
  {
    const { controller } = makeController(() => { throw new Error('Not connected'); });
    const svc = new MachineService({ current: controller }, makePortRef());

    await svc.disconnect();
    assert(
      laserStateOf(svc) === 'off',
      `thrown "Not connected" is swallowed — state stays 'off'`,
    );
  }

  // -------- 7. Source pins on the MachineService.disconnect implementation --------
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
    assert(/T1-164/.test(src), 'MachineService carries T1-164 marker');
    assert(
      /audit F-011/.test(src),
      'MachineService cross-references audit F-011 in T1-164 comment',
    );
    assert(
      /notifyLaserSafetyOutcome\(stage\)/.test(src),
      'MachineService.disconnect calls notifyLaserSafetyOutcome(stage)',
    );
    // The old "errors swallowed" comment must be gone — replaced with
    // the new (audit-aware) explanation.
    assert(
      !/\/\* not connected, buffer full, or port already gone \*\//.test(src),
      'old swallow-everything comment removed',
    );
    // Verify "Not connected" carve-out is documented in code.
    assert(
      /Not connected/.test(src),
      'MachineService.disconnect carve-out documents "Not connected" as the safe-swallow case',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
