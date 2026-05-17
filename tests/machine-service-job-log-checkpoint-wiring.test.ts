/**
 * S25-10-001: MachineService must wire running JobLog checkpointing.
 *
 * Run: npx tsx tests/machine-service-job-log-checkpoint-wiring.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type ControllerJobTicket,
  type ControllerOutput,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { getActiveProfile } from '../src/core/devices/DeviceProfile';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { createScene } from '../src/core/scene/Scene';
import {
  JobLogCheckpointer,
  type CheckpointStorage,
  type JobLogLike,
} from '../src/app/JobLogCheckpoint';
import { VirtualScheduler } from './helpers/VirtualScheduler';
import { makeTestFrameTicket } from './helpers/testFrameTicket';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';

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

class RecordingCheckpointStorage implements CheckpointStorage {
  readonly saves: JobLogLike[] = [];

  save(log: JobLogLike): void {
    this.saves.push({
      ...log,
      entries: [...log.entries],
    });
  }

  list(): JobLogLike[] {
    return this.saves.map(log => ({ ...log, entries: [...log.entries] }));
  }
}

function makeTicket(scene: ReturnType<typeof createScene>): ValidatedJobTicket {
  const plan = createEmptyPlan('s25-10-checkpoint');
  const profile = getActiveProfile();
  const gcodeText = 'G0 X1\nM5';
  return {
    ticketId: 'tkt_s25_10_checkpoint',
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
    gcodeLines: ['G0 X1', 'M5'],
    gcodeText,
    machinePlanBounds: { ...plan.bounds },
    machineTransform: {
      plan,
      offsetX: 0,
      offsetY: 0,
      flipReferenceY: 300,
      flipY: true,
      returnPosition: { x: 0, y: 0 },
    },
    controllerType: 'grbl',
    startMode: 'current',
    savedOrigin: null,
    createdAt: Date.now(),
  };
}

function canvasContextFor(ticket: ValidatedJobTicket): ActiveJobCanvasContext {
  return {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    machineTransform: ticket.machineTransform,
  };
}

function makeBlockingController(args: {
  onExecuteStarted: () => void;
  release: Promise<void>;
}): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: true,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (_output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      args.onExecuteStarted();
      await args.release;
      return { id: jobTicket.ticketId, startedAt: 123 };
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
  } as unknown as LaserController;
}

console.log('\n=== S25-10-001 MachineService job-log checkpoint wiring ===\n');

void (async () => {
  installMockLocalStorage();

  const scheduler = new VirtualScheduler();
  const storage = new RecordingCheckpointStorage();
  const checkpointer = new JobLogCheckpointer(scheduler, storage, {
    intervalMs: 100,
    now: () => scheduler.now,
  });

  let releaseExecute!: () => void;
  const release = new Promise<void>(resolve => {
    releaseExecute = resolve;
  });
  let executeStarted!: () => void;
  const started = new Promise<void>(resolve => {
    executeStarted = resolve;
  });

  const scene = createScene(120, 100, 'checkpoint wiring');
  const ticket = makeTicket(scene);
  const controller = makeBlockingController({
    onExecuteStarted: executeStarted,
    release,
  });
  const service = new MachineService(
    { current: controller },
    { current: null },
    { jobLogCheckpointer: checkpointer },
  );

  const startPromise = service.startValidatedJob({
    ticket,
    frameTicket: makeTestFrameTicket(ticket),
    scene,
    machineState: idle,
    notifySimulatorTx: () => {},
    canvasContext: canvasContextFor(ticket),
    currentStartMode: ticket.startMode,
    currentSavedOrigin: ticket.savedOrigin,
  });

  await started;
  scheduler.advanceBy(100);

  assert(storage.saves.length === 1,
    `running job checkpoint saved before finalization (got ${storage.saves.length})`);
  assert(storage.saves[0]?.status === 'running',
    `checkpoint preserves running status (got ${storage.saves[0]?.status ?? 'none'})`);
  assert(storage.saves[0]?.entries.some(entry => String(entry).includes('Job started'))
    || storage.saves[0]?.entries.length > 0,
    'checkpoint includes current log entries');

  const savesBeforeClear = storage.saves.length;
  service.clearJobSession();
  scheduler.advanceBy(100);
  assert(storage.saves.length === savesBeforeClear,
    'clearJobSession stops checkpoint timer');

  releaseExecute();
  await startPromise;

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
