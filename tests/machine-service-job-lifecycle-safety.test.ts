/**
 * MachineService job lifecycle safety regressions.
 * Run: npx tsx tests/machine-service-job-lifecycle-safety.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type JobProgress,
  type ControllerOutput,
  type ControllerJobTicket,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { getActiveProfile } from '../src/core/devices/DeviceProfile';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
import { createScene } from '../src/core/scene/Scene';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';
import { makeTestFrameTicket } from './helpers/testFrameTicket';

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

const memoryStore: Record<string, string> = {};
function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      return Object.keys(memoryStore)[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function makeTicket(
  scene: ReturnType<typeof createScene>,
  overrides?: Partial<ValidatedJobTicket>,
): ValidatedJobTicket {
  const plan = createEmptyPlan('job-lifecycle');
  const machineTransform = {
    plan,
    offsetX: 0,
    offsetY: 0,
    flipReferenceY: 300,
    flipY: true,
    returnPosition: { x: 0, y: 0 },
  };
  const gcodeLines = ['G0 X1', 'M5'] as const;
  const gcodeText = 'G0 X1\nM5';
  const profile = getActiveProfile();
  const ticket: ValidatedJobTicket = {
    ticketId: 'tkt_lifecycle',
    sceneHash: hashSceneForTicket(scene),
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
    emittedBurnBounds: null,
    burnEnvelopeDivergence: null,
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcodeText),
    fingerprint: makeTestJobFingerprint({
      scene,
      profile,
      startMode: 'current',
      savedOrigin: null,
    }),
    gcodeLines: [...gcodeLines],
    gcodeText,
    machinePlanBounds: { ...plan.bounds },
    machineTransform,
    controllerType: 'grbl',
    startMode: 'current',
    savedOrigin: null,
    createdAt: Date.now(),
  };
  const merged = { ...ticket, ...overrides };
  if (!overrides?.gcodeHash) {
    merged.gcodeHash = hashString(merged.gcodeText);
  }
  return merged;
}

function ctxFor(t: ValidatedJobTicket): ActiveJobCanvasContext {
  return {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    machineTransform: t.machineTransform,
  };
}

function makeController(sendJob: (lines: string[]) => Promise<void>): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      await sendJob([...output.lines]);
      return { id: jobTicket.ticketId, startedAt: 123 };
    },
    sendJob,
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

async function waitForContext(svc: MachineService): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (svc.getActiveJobCanvasContext()) return;
    await Promise.resolve();
  }
}

const doneProgress: JobProgress = {
  linesSent: 2,
  linesAcknowledged: 2,
  totalLines: 2,
  percentComplete: 100,
  elapsedMs: 0,
  bufferFill: 0,
  healthStatus: 'healthy',
  ackRateHz: null,
  expectedAckRateHz: null,
};

void (async () => {
  console.log('\n=== machine-service job lifecycle safety ===\n');
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const scene = createScene(120, 100, 'job lifecycle');
  const ticket = makeTicket(scene);

  {
    const controller = makeController(async () => new Promise<void>(() => {}));
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    const firstCtx = ctxFor(ticket);
    void svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: firstCtx,
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
    await waitForContext(svc);

    let err = '';
    const secondTicket = makeTicket(scene, { ticketId: 'tkt_second' });
    try {
      await svc.startValidatedJob({
        ticket: secondTicket,
        frameTicket: makeTestFrameTicket(secondTicket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(secondTicket),
        currentStartMode: secondTicket.startMode,
        currentSavedOrigin: secondTicket.savedOrigin,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(err.includes('already active'), 'double-start is rejected before mutating service state');
    assert(svc.getActiveJobCanvasContext() === firstCtx, 'failed second start preserves first context');
  }

  {
    let shouldFail = true;
    const controller = makeController(async () => {
      if (!shouldFail) return;
      throw new Error('send failed');
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    let err = '';
    try {
      await svc.startValidatedJob({
        ticket,
        frameTicket: makeTestFrameTicket(ticket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
        currentStartMode: ticket.startMode,
        currentSavedOrigin: ticket.savedOrigin,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(err === 'send failed', 'executeJob failure propagates');
    assert(svc.getActiveTicket() === null, 'send failure clears active ticket');
    assert(svc.getActiveJobCanvasContext() === null, 'send failure clears canvas context');

    shouldFail = false;
    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
    assert(svc.getActiveTicket()?.ticketId === ticket.ticketId, 'service can start again after failure');
  }

  {
    const controller = makeController(async () => {});
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
    await svc.tryFinalizeJobLog(idle, doneProgress, true, () => {});
    const finalizing = svc.tryFinalizeJobLog(idle, doneProgress, false, () => {});
    let err = '';
    const duringFinalizeTicket = makeTicket(scene, { ticketId: 'tkt_during_finalize' });
    try {
      await svc.startValidatedJob({
        ticket: duringFinalizeTicket,
        frameTicket: makeTestFrameTicket(duringFinalizeTicket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(duringFinalizeTicket),
        currentStartMode: duringFinalizeTicket.startMode,
        currentSavedOrigin: duringFinalizeTicket.savedOrigin,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(err.includes('already active'), 'new start is blocked while previous finalize is in flight');
    await finalizing;
    assert(svc.getActiveTicket() === null, 'finalize eventually clears previous ticket');
  }

  {
    let disconnectCalled = false;
    const controller = makeController(async () => {});
    controller.disconnect = async () => {
      disconnectCalled = true;
    };
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: {} as SerialPortLike } as { current: SerialPortLike | null },
    );
    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
    await svc.disconnect();
    assert(disconnectCalled, 'disconnect delegates to controller');
    assert(svc.getActiveTicket() === null, 'disconnect clears active ticket');
    assert(svc.getActiveJobCanvasContext() === null, 'disconnect clears active canvas context');
  }

  {
    let sendCalls = 0;
    const controller = makeController(async () => {
      sendCalls++;
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    const emptyTicket = makeTicket(scene, {
      ticketId: 'tkt_empty',
      gcodeLines: ['; only comments', '  '],
      gcodeText: '; only comments\n  ',
    });
    let err = '';
    try {
      await svc.startValidatedJob({
        ticket: emptyTicket,
        frameTicket: makeTestFrameTicket(emptyTicket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(emptyTicket),
        currentStartMode: emptyTicket.startMode,
        currentSavedOrigin: emptyTicket.savedOrigin,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(err.includes('no streamable'), 'empty/comment-only job is rejected');
    assert(sendCalls === 0, 'empty/comment-only job never reaches controller.executeJob');
    assert(svc.getActiveTicket() === null, 'empty/comment-only job leaves no active ticket');
  }

  {
    let sendCalls = 0;
    const controller = makeController(async () => {
      sendCalls++;
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    svc.notifyTestFire('begin');

    let err = '';
    try {
      await svc.startValidatedJob({
        ticket,
        frameTicket: makeTestFrameTicket(ticket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
        currentStartMode: ticket.startMode,
        currentSavedOrigin: ticket.savedOrigin,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(/laser.*on|laser-safety/i.test(err), 'start is blocked while laser output state is on');
    assert(sendCalls === 0, 'laser-on block prevents executeJob');
  }

  {
    let sendCalls = 0;
    const controller = makeController(async () => {
      sendCalls++;
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    const lease = svc.tryAcquireOperation('testFire');
    assert(lease !== null, 'precondition: acquired active operation lease');

    let err = '';
    try {
      await svc.startValidatedJob({
        ticket,
        frameTicket: makeTestFrameTicket(ticket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
        currentStartMode: ticket.startMode,
        currentSavedOrigin: ticket.savedOrigin,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      if (lease) svc.releaseOperation(lease);
    }
    assert(/testFire.*active|active operation|operation.*finish|busy/i.test(err), 'start is blocked while a temporary operation is active');
    assert(sendCalls === 0, 'active-operation block prevents executeJob');
  }

  {
    let sendCalls = 0;
    const controller = makeController(async () => {
      sendCalls++;
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    (svc as unknown as { _setSafetyState: (state: { kind: 'pausedVerified' }) => void })
      ._setSafetyState({ kind: 'pausedVerified' });

    let err = '';
    try {
      await svc.startValidatedJob({
        ticket,
        frameTicket: makeTestFrameTicket(ticket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
        currentStartMode: ticket.startMode,
        currentSavedOrigin: ticket.savedOrigin,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(/safe idle|safety state|pausedVerified/i.test(err), 'start is blocked while safety state is not safeIdle');
    assert(sendCalls === 0, 'non-safeIdle block prevents executeJob');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
