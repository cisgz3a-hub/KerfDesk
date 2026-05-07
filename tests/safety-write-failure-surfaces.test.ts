/**
 * T1-22 regression test: MachineService laser-output safety state plumbing.
 *
 * Bug: After a safety-off path ran and ended in soft-reset fallback (or
 * outright failure), nothing in the system knew that laser-output state was
 * uncertain. The next job-start could proceed even though the prior
 * laser-off intent was indeterminate.
 *
 * Fix: MachineService gains a `_laserOutputState` field. Coordinator pipes
 * outcomes via notifyTestFire and notifyLaserSafetyOutcome. startValidatedJob
 * refuses while state === 'unknown'. Connect resets to 'off'.
 *
 * This test exercises the service directly (no controller / coordinator
 * needed for the state-machine assertions). It also verifies the gate trips
 * inside startValidatedJob with a minimal mock controller and a synthetic
 * ticket — happy path + unknown-state-blocked path + cleared-state recovery.
 *
 * Run: npx tsx tests/safety-write-failure-surfaces.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import {
  type ControllerOutput,
  type ControllerJobTicket,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';
import type { ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createScene } from '../src/core/scene/Scene';
import type { ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import type { Scene } from '../src/core/scene/Scene';

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
    executeJob: async (_output: ControllerOutput, jobTicket: ControllerJobTicket) => ({ id: jobTicket.ticketId, startedAt: 123 }),
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

/**
 * Build a structurally-valid ticket whose hash matches a fresh scene so
 * validateTicket does not reject early on hash mismatch. We don't need the
 * job to actually run — startValidatedJob's safety-state gate is checked
 * before validateTicket. We construct the ticket only to pass the early
 * structural checks (or so the test asserts the safety gate fires before
 * any other rejection reason).
 */
function makeMinimalTicket(): { ticket: ValidatedJobTicket; scene: Scene } {
  const scene = createScene(400, 300, 'SafetyTest');
  const lines = ['G1 X10 F1000'] as const;
  const ticket: ValidatedJobTicket = {
    ticketId: 'test-ticket',
    sceneHash: 'unused-in-this-test', // safety gate fires before validateTicket
    profileHash: 'unused',
    machineInfoHash: 'unused',
    gcodeHash: 'unused',
    machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    preflightResults: {
      issues: [],
      hasErrors: false,
      hasWarnings: false,
      canStart: true,
    },
    startMode: 'current',
    savedOrigin: null,
    controllerType: 'grbl',
    createdAt: Date.now(),
    gcodeLines: lines as readonly string[],
    gcodeText: lines.join('\n'),
    activeProfileSnapshot: { id: 'p', name: 'p', controllerType: 'grbl' },
  } as unknown as ValidatedJobTicket;
  return { ticket, scene };
}

void (async () => {
  console.log('\n=== safety-write-failure-surfaces (T1-22) ===\n');

  // ── 1. Default state is 'off' ──────────────────────────────────────────
  {
    const svc = makeService();
    assert(
      svc.getLaserOutputState() === 'off',
      "default getLaserOutputState() === 'off'",
    );
  }

  // ── 2. notifyTestFire transitions ──────────────────────────────────────
  {
    const svc = makeService();
    svc.notifyTestFire('begin');
    assert(svc.getLaserOutputState() === 'on', "after begin → 'on'");
    svc.notifyTestFire('end');
    assert(svc.getLaserOutputState() === 'off', "after end → 'off'");
  }

  // ── 3. notifyLaserSafetyOutcome('m5') → 'off' ──────────────────────────
  {
    const svc = makeService();
    svc.notifyTestFire('begin');
    svc.notifyLaserSafetyOutcome('m5');
    assert(
      svc.getLaserOutputState() === 'off',
      "safetyOutcome 'm5' → 'off' (M5 confirmed)",
    );
  }

  // ── 4. notifyLaserSafetyOutcome('soft-reset') → 'unknown' ──────────────
  {
    const svc = makeService();
    svc.notifyLaserSafetyOutcome('soft-reset');
    assert(
      svc.getLaserOutputState() === 'unknown',
      "safetyOutcome 'soft-reset' → 'unknown' (M5 path indeterminate)",
    );
  }

  // ── 5. notifyLaserSafetyOutcome('failed') → 'unknown' ──────────────────
  {
    const svc = makeService();
    svc.notifyLaserSafetyOutcome('failed');
    assert(
      svc.getLaserOutputState() === 'unknown',
      "safetyOutcome 'failed' → 'unknown'",
    );
  }

  // ── 6. notifyTestFire('end') does NOT downgrade 'unknown' ──────────────
  {
    const svc = makeService();
    svc.notifyLaserSafetyOutcome('soft-reset');
    svc.notifyTestFire('end');
    assert(
      svc.getLaserOutputState() === 'unknown',
      "testFire 'end' does not downgrade 'unknown' state",
    );
  }

  // ── 7. clearLaserUnknownState resets only when 'unknown' ───────────────
  {
    const svc = makeService();
    svc.notifyLaserSafetyOutcome('soft-reset');
    svc.clearLaserUnknownState();
    assert(svc.getLaserOutputState() === 'off', "clearLaserUnknownState: 'unknown' → 'off'");

    // 'on' state — clearLaserUnknownState should be a no-op.
    svc.notifyTestFire('begin');
    svc.clearLaserUnknownState();
    assert(
      svc.getLaserOutputState() === 'on',
      "clearLaserUnknownState is a no-op when state is 'on'",
    );
  }

  // ── 8. startValidatedJob refuses while state === 'unknown' ─────────────
  {
    const svc = makeService();
    svc.notifyLaserSafetyOutcome('soft-reset');

    const { ticket, scene } = makeMinimalTicket();
    const canvasContext: ActiveJobCanvasContext = {
      canvasMoves: [],
      canvasPlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      machineTransform: {
        plan: { moves: [], origin: { x: 0, y: 0 } } as unknown as never,
        offsetX: 0,
        offsetY: 0,
        flipReferenceY: 300,
        flipY: false,
        returnPosition: { x: 0, y: 0 },
      },
    };

    let rejection: Error | null = null;
    try {
      await svc.startValidatedJob({
        ticket,
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext,
      });
    } catch (err) {
      rejection = err instanceof Error ? err : new Error(String(err));
    }

    assert(rejection !== null, "startValidatedJob rejects while state === 'unknown'");
    assert(
      rejection !== null
        && /unknown laser-safety state|laser-safety/i.test(rejection.message),
      'rejection message mentions the laser-safety reason',
    );
  }

  // ── 9. After clearLaserUnknownState, startValidatedJob proceeds past gate ─
  {
    const svc = makeService();
    svc.notifyLaserSafetyOutcome('soft-reset');
    svc.clearLaserUnknownState();
    assert(svc.getLaserOutputState() === 'off', 'sanity: cleared back to off');

    const { ticket, scene } = makeMinimalTicket();
    const canvasContext: ActiveJobCanvasContext = {
      canvasMoves: [],
      canvasPlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      machineTransform: {
        plan: { moves: [], origin: { x: 0, y: 0 } } as unknown as never,
        offsetX: 0,
        offsetY: 0,
        flipReferenceY: 300,
        flipY: false,
        returnPosition: { x: 0, y: 0 },
      },
    };

    let rejection: Error | null = null;
    try {
      await svc.startValidatedJob({
        ticket,
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext,
      });
    } catch (err) {
      rejection = err instanceof Error ? err : new Error(String(err));
    }

    // After clearing, the safety gate must NOT be the reason for rejection.
    // The job may still be rejected for ticket validation (hash mismatch in
    // our synthetic ticket) — that's fine. We only assert the message is
    // not about laser safety.
    assert(
      rejection === null
        || !/unknown laser-safety state|laser-safety/i.test(rejection.message),
      'after clearLaserUnknownState: any rejection is NOT a laser-safety rejection',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
