/**
 * MachineService job lifecycle safety regressions.
 * Run: npx tsx tests/machine-service-job-lifecycle-safety.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type JobProgress,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { getActiveProfile } from '../src/core/devices/DeviceProfile';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { createScene } from '../src/core/scene/Scene';
import { createEmptyPlan } from '../src/core/plan/Plan';

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
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcodeText),
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
    executeJob: async (output, jobTicket) => {
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
  } as LaserController;
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
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: firstCtx,
    });
    await waitForContext(svc);

    let err = '';
    try {
      await svc.startValidatedJob({
        ticket: makeTicket(scene, { ticketId: 'tkt_second' }),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
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
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
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
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
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
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
    });
    await svc.tryFinalizeJobLog(idle, doneProgress, true, () => {});
    const finalizing = svc.tryFinalizeJobLog(idle, doneProgress, false, () => {});
    let err = '';
    try {
      await svc.startValidatedJob({
        ticket: makeTicket(scene, { ticketId: 'tkt_during_finalize' }),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
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
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
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
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(emptyTicket),
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(err.includes('no streamable'), 'empty/comment-only job is rejected');
    assert(sendCalls === 0, 'empty/comment-only job never reaches controller.executeJob');
    assert(svc.getActiveTicket() === null, 'empty/comment-only job leaves no active ticket');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
