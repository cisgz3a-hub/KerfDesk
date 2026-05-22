/**
 * After tryFinalize had a chance to see isJobRunning=true, idle+!isJobRunning
 * finalizes and clears T1-11 context.
 * Run: npx tsx tests/try-finalize-after-observed-running.test.ts
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
  const plan = createEmptyPlan('try-fin-after');
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
    ticketId: 'tkt_try_fin_after',
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
  const profile = createBlankProfile('Try Finalize After Observed Running Test');
  profile.bedWidth = 120;
  profile.bedHeight = 100;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
}

void (async () => {
  console.log('\n=== tryFinalize after observed running (final path) ===\n');
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  installActiveProfile();

  const scene = createScene(120, 100, 'after-obs');
  const ticket = makeTicket(scene);

  const mock = {
    protocolName: 'm',
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
  const controllerRef = { current: mock } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);
  const cctx = ctxFor(ticket);

  await svc.startValidatedJob({
    ticket,
    frameTicket: makeTestFrameTicket(ticket),
    scene,
    machineState: idle,
    notifySimulatorTx: () => {},
    canvasContext: cctx,
    currentStartMode: ticket.startMode,
    currentSavedOrigin: ticket.savedOrigin,
  });

  assert(svc.getActiveJobCanvasContext() != null, 'context set after start');

  const progress: JobProgress = {
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
  const zeroProgress: JobProgress = {
    linesSent: 0,
    linesAcknowledged: 0,
    totalLines: 0,
    percentComplete: 0,
    elapsedMs: 0,
    bufferFill: 0,
    healthStatus: 'healthy',
    ackRateHz: null,
    expectedAckRateHz: null,
  };
  const messages: string[] = [];
  const append = (m: string): void => {
    messages.push(m);
  };

  await svc.tryFinalizeJobLog(idle, zeroProgress, true, append);
  assert(
    svc.getActiveJobCanvasContext() === cctx,
    'context still set after isJobRunning=true tick (no idle finalize yet)',
  );

  await svc.tryFinalizeJobLog(idle, progress, false, append);
  assert(svc.getActiveJobCanvasContext() === null, 'context cleared on real finalize');
  assert(svc.getActiveTicket() === null, 'ticket cleared on real finalize');
  assert(
    messages.length > 0,
    'appendMessage received at least one line from finalize or save',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
