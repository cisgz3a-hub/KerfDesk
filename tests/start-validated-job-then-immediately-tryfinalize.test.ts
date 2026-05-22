/**
 * Regression: stale tryFinalize(idle, !running) during startValidatedJob await
 * must not clear activeJobCanvasContext before the job is observed running.
 * Run: npx tsx tests/start-validated-job-then-immediately-tryfinalize.test.ts
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
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
import {
  createBlankProfile,
  getActiveProfile,
  resetDeviceProfilesForTest,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';
import { makeTestFrameTicket } from './helpers/testFrameTicket';

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

function makeTicket(scene: ReturnType<typeof createScene>): ValidatedJobTicket {
  const plan = createEmptyPlan('tryfin-race');
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
  return {
    ticketId: 'tkt_tryfin_race',
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
}

function ctxFor(t: ValidatedJobTicket): ActiveJobCanvasContext {
  return {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    machineTransform: t.machineTransform,
  };
}

function installActiveProfile(): void {
  resetDeviceProfilesForTest();
  const profile = createBlankProfile('Start Then Try Finalize Test');
  profile.bedWidth = 120;
  profile.bedHeight = 100;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
}

void (async () => {
  console.log('\n=== startValidatedJob + immediate stale tryFinalize (race) ===\n');
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  installActiveProfile();

  const scene = createScene(120, 100, 'race');
  const ticket = makeTicket(scene);
  const cctx = ctxFor(ticket);

  const mock = {
    protocolName: 'm',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (_output: ControllerOutput, _jobTicket: ControllerJobTicket) => new Promise(() => {}),
    sendJob: async () => new Promise<void>(() => {}),
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
  const controllerRef = { current: mock } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);

  void svc.startValidatedJob({
    ticket,
    frameTicket: makeTestFrameTicket(ticket),
    scene,
    machineState: idle,
    notifySimulatorTx: () => {},
    canvasContext: cctx,
    currentStartMode: ticket.startMode,
    currentSavedOrigin: ticket.savedOrigin,
  });
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    if (svc.getActiveJobCanvasContext() != null) break;
  }

  const progress: JobProgress = {
    linesSent: 0,
    linesAcknowledged: 0,
    totalLines: 2,
    percentComplete: 0,
    elapsedMs: 0,
    bufferFill: 0,
    healthStatus: 'healthy',
    ackRateHz: null,
    expectedAckRateHz: null,
  };
  await svc.tryFinalizeJobLog(idle, progress, false, () => {});

  assert(
    svc.getActiveJobCanvasContext() === cctx,
    'canvas context not cleared by stale tryFinalize during job start',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
