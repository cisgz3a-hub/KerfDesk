/**
 * T2-12 part 1 regression test: MachineService laser-output-state
 * subscription contract.
 *
 * Bug class addressed: ConnectionPanelMain previously read laser-output
 * state via a polled getter, refreshed only when workflowVersion (or some
 * adjacent state) bumped. The polled approach worked but was fragile: any
 * future caller that mutated the state without an adjacent state change
 * would render the UI gate stale until the next unrelated re-render.
 *
 * Fix: MachineService gains onLaserOutputStateChange(cb) returning an
 * unsubscribe function. All five mutation sites
 * (notifyTestFire begin / end, notifyLaserSafetyOutcome m5 / not-m5,
 * clearLaserUnknownState, connect-time reset) route through a private
 * _setLaserOutputState that fires listeners only on actual transitions
 * (no-op writes are skipped).
 *
 * This test exercises the subscription contract directly. It does NOT
 * re-test T1-22 plumbing (which safety-write-failure-surfaces.test.ts
 * covers via the polled getter that remains intact).
 *
 * Run: npx tsx tests/machine-service-laser-state-subscription.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
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

function makeController(): LaserController {
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
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
  } as unknown as LaserController;
}

function makeService(): MachineService {
  const controllerRef = { current: makeController() } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  return new MachineService(controllerRef, portRef);
}

void (async () => {
  console.log('\n=== machine-service laser-state subscription (T2-12 part 1) ===\n');

  // ── 1. Subscribe receives transitions ────────────────────────────────
  {
    const svc = makeService();
    const events: Array<'off' | 'on' | 'unknown'> = [];
    const unsubscribe = svc.onLaserOutputStateChange(s => events.push(s));

    // Default is 'off'. notifyTestFire('begin') -> 'on'.
    svc.notifyTestFire('begin');
    assert(
      events.length === 1 && events[0] === 'on',
      "subscriber receives 'on' after notifyTestFire('begin')",
    );

    // notifyTestFire('end') -> 'off' (state transitions, listener fires).
    svc.notifyTestFire('end');
    assert(
      events.length === 2 && events[1] === 'off',
      "subscriber receives 'off' after notifyTestFire('end')",
    );

    // notifyLaserSafetyOutcome('soft-reset') -> 'unknown'.
    svc.notifyLaserSafetyOutcome('soft-reset');
    assert(
      events.length === 3 && events[2] === 'unknown',
      "subscriber receives 'unknown' after notifyLaserSafetyOutcome('soft-reset')",
    );

    unsubscribe();
  }

  // ── 2. No-op writes do NOT fire the listener ────────────────────────
  {
    const svc = makeService();
    const events: Array<'off' | 'on' | 'unknown'> = [];
    const unsubscribe = svc.onLaserOutputStateChange(s => events.push(s));

    // State starts at 'off'. notifyTestFire('end') with state already
    // 'off' is a no-op - !== 'unknown' guard passes, but
    // _setLaserOutputState's change-detection skips the notify.
    svc.notifyTestFire('end');
    assert(
      events.length === 0,
      "no notify when notifyTestFire('end') keeps state at 'off'",
    );

    // clearLaserUnknownState while state is 'off' is doubly guarded
    // (outer guard + inner change-detection). Either way: no notify.
    svc.clearLaserUnknownState();
    assert(
      events.length === 0,
      'no notify when clearLaserUnknownState runs against non-unknown state',
    );

    // notifyLaserSafetyOutcome('m5') against state-already-'off' -> no-op.
    svc.notifyLaserSafetyOutcome('m5');
    assert(
      events.length === 0,
      "no notify when notifyLaserSafetyOutcome('m5') keeps state at 'off'",
    );

    // Now sanity: a real transition fires exactly once.
    svc.notifyTestFire('begin');
    assert(
      events.length === 1 && events[0] === 'on',
      'real transition after no-op writes still fires exactly once',
    );

    unsubscribe();
  }

  // ── 3. Unsubscribe stops further notifications ───────────────────────
  {
    const svc = makeService();
    const events: Array<'off' | 'on' | 'unknown'> = [];
    const unsubscribe = svc.onLaserOutputStateChange(s => events.push(s));

    svc.notifyTestFire('begin');
    assert(events.length === 1, 'pre-unsubscribe transition received');

    unsubscribe();

    svc.notifyTestFire('end');
    svc.notifyLaserSafetyOutcome('soft-reset');
    svc.clearLaserUnknownState();
    assert(
      events.length === 1,
      'no further notifications after unsubscribe()',
    );
  }

  // ── 4. Multiple subscribers all fire ─────────────────────────────────
  {
    const svc = makeService();
    const eventsA: Array<'off' | 'on' | 'unknown'> = [];
    const eventsB: Array<'off' | 'on' | 'unknown'> = [];
    const unsubA = svc.onLaserOutputStateChange(s => eventsA.push(s));
    const unsubB = svc.onLaserOutputStateChange(s => eventsB.push(s));

    svc.notifyTestFire('begin');
    assert(
      eventsA.length === 1 && eventsB.length === 1,
      'both subscribers receive the same transition',
    );
    assert(
      eventsA[0] === 'on' && eventsB[0] === 'on',
      'both subscribers see the same payload',
    );

    // Unsubscribe one; the other still fires.
    unsubA();
    svc.notifyTestFire('end');
    assert(
      eventsA.length === 1 && eventsB.length === 2,
      'partial unsubscribe leaves remaining subscribers active',
    );

    unsubB();
  }

  // ── 5. getLaserOutputState remains accurate after subscription ────────
  {
    const svc = makeService();
    const events: Array<'off' | 'on' | 'unknown'> = [];
    svc.onLaserOutputStateChange(s => events.push(s));

    svc.notifyLaserSafetyOutcome('failed');
    assert(
      svc.getLaserOutputState() === 'unknown',
      "getLaserOutputState() reflects 'unknown' after notifyLaserSafetyOutcome('failed')",
    );
    assert(
      events[events.length - 1] === 'unknown',
      "subscriber's last event matches the getter ('unknown')",
    );

    svc.clearLaserUnknownState();
    assert(
      svc.getLaserOutputState() === 'off',
      "getLaserOutputState() reflects 'off' after clearLaserUnknownState()",
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
