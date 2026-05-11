/**
 * MachineService wake lock (T1-10). Run: npx tsx tests/wake-lock.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import {
  type JobProgress,
  type ControllerOutput,
  type ControllerJobTicket,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { getActiveProfile } from '../src/core/devices/DeviceProfile';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

let acquireCallCount = 0;
let releaseCallCount = 0;

function installElectronApiWakeLockSpies(): void {
  acquireCallCount = 0;
  releaseCallCount = 0;
  (globalThis as unknown as { electronAPI: unknown }).electronAPI = {
    acquireJobWakeLock: async () => {
      acquireCallCount++;
      return 42;
    },
    releaseJobWakeLock: async () => {
      releaseCallCount++;
    },
  };
}

function removeElectronApi(): void {
  delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;
}

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
      const keys = Object.keys(memoryStore);
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function makeTestTicket(scene: ReturnType<typeof createScene>, overrides?: Partial<ValidatedJobTicket>): ValidatedJobTicket {
  const plan = createEmptyPlan('wake-lock-test');
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
  const baseTicket: ValidatedJobTicket = {
    ticketId: 'tkt_wake_lock',
    sceneHash: hashSceneForTicket(scene),
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
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
  const merged = { ...baseTicket, ...overrides };
  if (!overrides?.gcodeHash) {
    merged.gcodeHash = hashString(merged.gcodeText);
  }
  return merged;
}

function canvasContextForTicket(t: ValidatedJobTicket): ActiveJobCanvasContext {
  return {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    machineTransform: t.machineTransform,
  };
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeMockController(sendJobImpl: (lines: string[]) => Promise<void>): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      await sendJobImpl([...output.lines]);
      return { id: jobTicket.ticketId, startedAt: 123 };
    },
    sendJob: sendJobImpl,
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

async function run(): Promise<void> {
  console.log('\n=== wake lock (MachineService) ===\n');

  const scene = createScene(120, 100, 'wake lock test');
  const ticket = makeTestTicket(scene);

  {
    installElectronApiWakeLockSpies();
    const mock = makeMockController(async () => {
      assert(acquireCallCount === 1, 'acquire ran exactly once before executeJob body runs');
    });
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
    });

    assert(acquireCallCount === 1, 'acquireJobWakeLock invoked exactly once for successful start');
    removeElectronApi();
  }

  {
    installElectronApiWakeLockSpies();
    installMockLocalStorage();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];

    const mock = makeMockController(async () => {});
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
    });

    const progress = {
      linesSent: 2,
      linesAcknowledged: 2,
      totalLines: 2,
      percentComplete: 100,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy',
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;
    const zeroProgress = {
      linesSent: 0,
      linesAcknowledged: 0,
      totalLines: 0,
      percentComplete: 0,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy' as const,
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;
    await svc.tryFinalizeJobLog(idle, zeroProgress, true, () => {});
    await svc.tryFinalizeJobLog(idle, progress, false, () => {});

    assert(releaseCallCount === 1, 'tryFinalizeJobLog invokes releaseJobWakeLock once');
    removeElectronApi();
  }

  {
    installElectronApiWakeLockSpies();
    const mock = makeMockController(async () => {});
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
    });

    svc.clearJobSession();

    assert(releaseCallCount === 1, 'clearJobSession invokes releaseJobWakeLock');
    removeElectronApi();
  }

  {
    installElectronApiWakeLockSpies();
    const mock = makeMockController(async () => {});
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
    });

    await svc.disconnect();

    assert(releaseCallCount === 1, 'disconnect invokes releaseJobWakeLock');
    removeElectronApi();
  }

  {
    installElectronApiWakeLockSpies();
    const mock = makeMockController(async () => {});
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    const otherScene = createScene(200, 200, 'stale scene');
    let threw = false;
    try {
      await svc.startValidatedJob({
        ticket,
        scene: otherScene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: canvasContextForTicket(ticket),
      });
    } catch {
      threw = true;
    }

    assert(threw, 'stale scene causes startValidatedJob to throw');
    assert(acquireCallCount === 0, 'wake lock not acquired when ticket validation fails');
    removeElectronApi();
  }

  {
    removeElectronApi();
    let sendJobCalls = 0;
    const mock = makeMockController(async () => {
      sendJobCalls++;
    });
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    let threw = false;
    try {
      await svc.startValidatedJob({
        ticket,
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: canvasContextForTicket(ticket),
      });
    } catch {
      threw = true;
    }

    assert(!threw, 'without electronAPI, startValidatedJob does not throw');
    assert(sendJobCalls === 1, 'without electronAPI, executeJob still runs');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
