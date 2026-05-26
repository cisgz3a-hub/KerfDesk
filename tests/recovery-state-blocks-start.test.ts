/**
 * T1-122/T-GRBL4040: regression test that MachineService owns
 * RecoveryState without letting the stale checklist become a hard
 * Start gate. Pre-T1-122 the runtime type at
 * `src/runtime/RecoveryState.ts` (T2-87) was framework-only — no
 * production code held a RecoveryState instance, no triggers fired,
 * and `recoveryAllowsStart()` was never consulted by the UI's local
 * `canStartJob` or by `MachineService.startValidatedJob`. Audit's
 * Phase 2 #6 finding flagged this as a "foundation exists but product
 * does not use it" gap.
 *
 * Post-T1-122 MachineService is the canonical owner. This test pins:
 *   - getRecoveryState / setRecoveryState / acknowledgeRecoveryComplete
 *     wired
 *   - onRecoveryStateChange listener fires on transitions
 *   - RecoveryState still records alarm / stop recovery state
 *   - startValidatedJob no longer consumes RecoveryState directly
 *   - alarm during an active job auto-triggers triggerAlarm via the
 *     existing onStateChange subscriber
 *   - notifyLaserSafetyOutcome('failed') auto-triggers
 *     triggerEmergencyStop (matching the laser-output-unknown
 *     contract)
 *   - source-pin: ConnectionPanelMain still reads recovery state for
 *     guidance but no longer ANDs it into canStartJob
 *
 * Run: npx tsx tests/recovery-state-blocks-start.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type MutableRefObject } from 'react';
import { MachineService } from '../src/app/MachineService';
// T1-219: acknowledgeRecoveryComplete now requires a bypass token
// when an active recovery is in flight.
import { createUnsafeRecoveryBypassToken } from '../src/app/RecoveryBypassToken';
import { type SerialPortLike } from '../src/communication/SerialPort';

const TEST_BYPASS_TOKEN = createUnsafeRecoveryBypassToken(
  'test fixture: T1-122 recovery-state-blocks-start coverage'
);
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { ackInspection, ackUnlock, ackRehome, ackReframe } from '../src/runtime/RecoveryState';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

const alarm: MachineState = {
  ...idle,
  status: 'alarm',
  alarmCode: 1,
};

function makeController(): { ctrl: LaserController; fireStateChange: (s: MachineState) => void } {
  const stateListeners: Array<(s: MachineState) => void> = [];
  let currentState = idle;
  const ctrl = {
    family: 'grbl' as const,
    protocolName: 'mock',
    state: currentState,
    isJobRunning: false,
    maxSpindle: 1000,
    operations: {
      jog: async () => ({ ok: true as const }),
      home: async () => ({ ok: true as const }),
      unlockAlarm: async () => ({ ok: true as const }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
      resetWcsToMachineOrigin: async () => ({ ok: true as const }),
      testFire: async () => ({ ok: true as const }),
      frame: async () => ({ ok: true as const }),
      laserOff: async () => ({ ok: true as const }),
      pauseJob: async () => ({ ok: true as const }),
      resumeJob: async () => ({ ok: true as const }),
      stopJob: async () => ({ ok: true as const }),
      emergencyStop: async () => ({ ok: true as const }),
    },
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: (cb: (s: MachineState) => void) => {
      stateListeners.push(cb);
      return () => {
        const i = stateListeners.indexOf(cb);
        if (i >= 0) stateListeners.splice(i, 1);
      };
    },
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
  } as unknown as LaserController;
  const fireStateChange = (s: MachineState): void => {
    currentState = s;
    (ctrl as unknown as { state: MachineState }).state = s;
    for (const cb of stateListeners) cb(s);
  };
  return { ctrl, fireStateChange };
}

console.log('\n=== T1-122 RecoveryState advisory, controller gates canonical ===\n');

void (async () => {

// -------- 1. default state is 'none' --------
{
  const { ctrl } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);
  const r = svc.getRecoveryState();
  assert(r.status === 'none', 'fresh MachineService starts with recovery.status === "none"');
}

// -------- 2. setRecoveryState fires the change listener --------
{
  const { ctrl } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  const seen: string[] = [];
  const unsub = svc.onRecoveryStateChange((s) => seen.push(s.status));

  // Identity-equal write is a no-op (matches the laser-output / safety
  // listener contract).
  const sameRef = svc.getRecoveryState();
  svc.setRecoveryState(sameRef);
  assert(seen.length === 0, 'setRecoveryState with identical reference does not fire listener');

  svc.setRecoveryState({
    status: 'alarm',
    alarmCode: 1,
    occurredAt: 0,
    requiresRehome: false,
    inspectionDone: false,
    unlockDone: false,
    rehomeDone: false,
    reframeDone: false,
  });
  assert(seen.length === 1 && seen[0] === 'alarm',
    'setRecoveryState fires listener with new status');

  svc.acknowledgeRecoveryComplete(TEST_BYPASS_TOKEN);
  assert(seen.length === 2 && seen[1] === 'none',
    'acknowledgeRecoveryComplete transitions to none and fires listener');

  unsub();
  svc.acknowledgeRecoveryComplete(TEST_BYPASS_TOKEN); // no-op (already none) — no extra fire
  assert(seen.length === 2, 'unsubscribed listener stops receiving updates');
}

// -------- 3. RecoveryState can stay active without being the job-start authority --------
{
  const { ctrl } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  svc.setRecoveryState({
    status: 'alarm',
    alarmCode: 1,
    occurredAt: 0,
    requiresRehome: false,
    inspectionDone: false,
    unlockDone: false,
    rehomeDone: false,
    reframeDone: false,
  });

  const r = svc.getRecoveryState();
  assert(r.status === 'alarm', 'RecoveryState still records active alarm recovery');
}

// -------- 4. After per-step ack chain → recovery clears → start no longer recovery-blocked --------
{
  const { ctrl } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  svc.setRecoveryState({
    status: 'alarm',
    alarmCode: 1,
    occurredAt: 0,
    requiresRehome: true,
    inspectionDone: false,
    unlockDone: false,
    rehomeDone: false,
    reframeDone: false,
  });

  // T1-219: walk the per-step ack chain via the new
  // applyRecoveryAck API. Pre-T1-219 the test computed
  // `ackInspection(svc.getRecoveryState())` itself and passed the
  // result to `setRecoveryState` — that path is now gated for the
  // 'none' auto-clear transition (anti-bypass). The new
  // applyRecoveryAck method on the service applies the runtime
  // ack helper internally so the legitimate clear remains
  // token-free.
  svc.applyRecoveryAck('inspection');
  svc.applyRecoveryAck('unlock');
  svc.applyRecoveryAck('rehome');
  svc.applyRecoveryAck('reframe');

  assert(svc.getRecoveryState().status === 'none',
    'four required acks → recovery transitions to "none"');
}

// -------- 5. Live alarm during active job auto-triggers via onStateChange --------
{
  const { ctrl, fireStateChange } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  // Stash an active ticket so the auto-trigger condition fires.
  // (Tickets exists check is `this.activeTicket != null`.)
  (svc as unknown as { activeTicket: ValidatedJobTicket | null }).activeTicket =
    { ticketId: 'fake' } as unknown as ValidatedJobTicket;

  svc.attachAutoFinalize(ctrl);

  // Recovery starts at 'none'.
  assert(svc.getRecoveryState().status === 'none',
    'precondition: recovery is "none" before alarm');

  // Fire alarm.
  fireStateChange(alarm);

  const r = svc.getRecoveryState();
  assert(r.status === 'alarm',
    `live alarm during active job auto-triggers triggerAlarm (got '${r.status}')`);
  if (r.status === 'alarm') {
    assert(r.alarmCode === 1, 'alarm code captured in trigger');
    assert(r.requiresRehome === true, 'requiresRehome defaults to true');
  }
}

// -------- 6. Live alarm WITHOUT an active job does NOT trigger recovery --------
{
  const { ctrl, fireStateChange } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  // No active ticket.
  svc.attachAutoFinalize(ctrl);
  fireStateChange(alarm);

  assert(svc.getRecoveryState().status === 'none',
    'alarm without active job does not trip recovery (idle alarm path is preflight territory)');
}

// -------- 7. notifyLaserSafetyOutcome('failed') auto-triggers triggerEmergencyStop --------
{
  const { ctrl } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  svc.notifyLaserSafetyOutcome('failed');

  const r = svc.getRecoveryState();
  assert(r.status === 'emergencyStopped',
    `failed safetyOff → recovery 'emergencyStopped' (got '${r.status}')`);
}

// -------- 8. notifyLaserSafetyOutcome('soft-reset') also triggers emergencyStopped --------
{
  const { ctrl } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  svc.notifyLaserSafetyOutcome('soft-reset');
  assert(svc.getRecoveryState().status === 'emergencyStopped',
    'soft-reset safetyOff → emergencyStopped (M5 path was indeterminate)');
}

// -------- 9. notifyLaserSafetyOutcome('m5') does NOT trigger recovery --------
{
  const { ctrl } = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const svc = new MachineService(ref, portRef);

  svc.notifyLaserSafetyOutcome('m5');
  assert(svc.getRecoveryState().status === 'none',
    'clean m5 safetyOff → recovery stays "none"');
}

// -------- Source-level pins --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');

  const svcSrc = readFileSync(resolve(repoRoot, 'src/app/MachineService.ts'), 'utf-8');
  assert(/T1-122/.test(svcSrc), 'MachineService.ts carries T1-122 marker');
  assert(!/recoveryAllowsStart\(this\._recoveryState\)/.test(svcSrc),
    'MachineService.startValidatedJob no longer hard-blocks on RecoveryState');
  assert(/triggerAlarm\(/.test(svcSrc),
    'MachineService imports / calls triggerAlarm');
  assert(/triggerEmergencyStop\(/.test(svcSrc),
    'MachineService imports / calls triggerEmergencyStop');
  assert(/onRecoveryStateChange/.test(svcSrc),
    'MachineService exposes onRecoveryStateChange listener');
  assert(/acknowledgeRecoveryComplete/.test(svcSrc),
    'MachineService exposes acknowledgeRecoveryComplete');

  const panelSrc = readFileSync(
    resolve(repoRoot, 'src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(!/import \{ recoveryAllowsStart \} from '\.\.\/\.\.\/runtime\/RecoveryState'/.test(panelSrc),
    'ConnectionPanelMain does not import recoveryAllowsStart for Start gating');
  assert(!/recoveryAllowsStart\(recoveryState\)/.test(panelSrc),
    'ConnectionPanelMain canStartJob no longer conjuncts RecoveryState');
  assert(/onRecoveryStateChange\(setRecoveryStateLocal\)/.test(panelSrc),
    'ConnectionPanelMain subscribes to onRecoveryStateChange');
  assert(/T1-122/.test(panelSrc), 'ConnectionPanelMain carries T1-122 marker');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})().catch((e) => { console.error(e); process.exit(1); });
