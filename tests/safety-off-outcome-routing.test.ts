/**
 * Regression coverage for controller-owned safetyOff paths.
 *
 * The older T1-24/T1-28 tests proved that autofocus/error/alarm paths
 * attempt safetyOff(). This file pins the stronger runtime invariant:
 * the safetyOff outcome must reach MachineService so soft-reset/failed
 * outcomes latch laserOutputState='unknown' and trigger recovery.
 *
 * Run: npx tsx tests/safety-off-outcome-routing.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort, type SerialPortLike } from '../src/communication/SerialPort';
import type {
  ControllerJobTicket,
  ControllerOutput,
  LaserController,
  MachineState,
  SafetyOffOutcomeCallback,
} from '../src/controllers/ControllerInterface';
import type { ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import type { ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import {
  captureEntitlementPolicySnapshot,
  hashEntitlementPolicy,
  hashReferencedMaterialPresets,
} from '../src/core/job/compileInputHashes';
import {
  initializeDeviceProfiles,
  getActiveProfile,
  resetDeviceProfilesForTest,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';
import { makeTestFrameTicket } from './helpers/testFrameTicket';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  [pass] ${message}`);
  } else {
    failed++;
    console.error(`  [fail] ${message}`);
  }
}

function flush(ms = 25): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function activeAutofocusProfile(): DeviceProfile {
  return {
    id: 'safety-routing-af',
    name: 'Safety routing autofocus profile',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    machineType: 'diode',
    watts: 20,
    brand: 'Test',
    model: 'Laser',
    bedWidth: 400,
    bedHeight: 400,
    originCorner: 'front-left',
    maxFeedRate: 6000,
    maxSpindle: 1000,
    homingEnabled: true,
    softLimitsEnabled: false,
    invertY: true,
    returnToOrigin: true,
    baudRate: 115200,
    startGcode: '',
    endGcode: '',
    autoFocusSupported: true,
    autoFocusCommand: '$HZ1',
    autoFocusTimeoutMs: 30,
  };
}

async function installProfile(): Promise<void> {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  setStorageForTest(new InMemoryStorageAdapter());
  resetDeviceProfilesForTest();
  await initializeDeviceProfiles();
  const profile = activeAutofocusProfile();
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
}

function fakeControllerWithAutofocusError(stage: 'm5' | 'soft-reset' | 'failed'): LaserController {
  return {
    protocolName: 'mock',
    state: {
      status: 'idle',
      position: { x: 0, y: 0, z: 0 },
      feedRate: 0,
      spindleSpeed: 0,
      alarmCode: null,
      errorCode: null,
    },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async () => ({ id: 'mock-job', startedAt: Date.now() }),
    sendJob: async () => {},
    pause: async () => ({ action: 'pause', accepted: true, timestamp: Date.now() }),
    resume: async () => ({ action: 'resume', accepted: true, timestamp: Date.now() }),
    stop: () => ({ action: 'abortJob', accepted: true, timestamp: Date.now() }),
    emergencyStop: () => ({ action: 'emergencyStop', accepted: true, timestamp: Date.now() }),
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage }),
    onObjectLifecycle: () => () => {},
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      testFire: async () => ({ ok: true }),
      frame: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
    runAutoFocus: async () => {
      const err = new Error('Auto-focus timed out - safety-off attempted') as Error & {
        safetyOffStage?: 'm5' | 'soft-reset' | 'failed';
      };
      err.safetyOffStage = stage;
      throw err;
    },
  } as unknown as LaserController;
}

const idleState: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeTicket(scene: ReturnType<typeof createScene>): ValidatedJobTicket {
  const plan = createEmptyPlan('safety-off-routing');
  const profile = getActiveProfile();
  const gcodeText = 'G0 X1\nM5';
  const machineTransform = {
    plan,
    offsetX: 0,
    offsetY: 0,
    flipReferenceY: 300,
    flipY: true,
    returnPosition: { x: 0, y: 0 },
  };
  return {
    ticketId: 'tkt_safety_off_routing',
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
    machineTransform,
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

function controllerThatEmitsSafetyOutcomeDuringExecute(): LaserController {
  const listeners = new Set<SafetyOffOutcomeCallback>();
  return {
    protocolName: 'mock',
    state: idleState,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      setTimeout(() => {
        for (const cb of listeners) {
          cb({ source: 'job-error', stage: 'soft-reset', code: 9 });
        }
      }, 0);
      return { id: jobTicket.ticketId, startedAt: Date.now() };
    },
    sendJob: async () => {},
    pause: async () => ({ action: 'pause', accepted: true, timestamp: Date.now() }),
    resume: async () => ({ action: 'resume', accepted: true, timestamp: Date.now() }),
    stop: () => ({ action: 'abortJob', accepted: true, timestamp: Date.now() }),
    emergencyStop: () => ({ action: 'emergencyStop', accepted: true, timestamp: Date.now() }),
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    onSafetyOffOutcome: (cb: SafetyOffOutcomeCallback) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    safetyOff: async () => ({ stage: 'm5' as const }),
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      testFire: async () => ({ ok: true }),
      frame: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
}

async function makeConnectedGrbl(): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const ctrl = new GrblController({ allowHeadlessWcsAutoNormalize: true });
  const port = new MockSerialPort((line: string) => {
    if (line === '$I') return ['[VER:1.1h.20221128:]', 'ok'];
    if (line === '$$') {
      return [
        '$30=1000', '$32=1', '$22=0', '$23=0',
        '$120=500', '$121=500', '$130=400', '$131=300', '$110=6000', '$111=6000', 'ok',
      ];
    }
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return [];
  });
  port.open();
  await ctrl.connect(port);
  await flush(50);
  return { ctrl, port };
}

async function run(): Promise<void> {
  console.log('\n=== safety-off outcome routing ===\n');

  {
    await installProfile();
    const controller = fakeControllerWithAutofocusError('soft-reset');
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );

    const result = await svc.autoFocus();

    assert(!result.ok && /timed out/i.test(result.error), 'autofocus surfaces the original failure');
    assert(
      svc.getLaserOutputState() === 'unknown',
      "autofocus soft-reset safetyOff outcome routes to laserOutputState='unknown'",
    );
    assert(
      svc.getRecoveryState().status !== 'none',
      'autofocus soft-reset safetyOff outcome triggers recovery',
    );
  }

  {
    const { ctrl, port } = await makeConnectedGrbl();
    const svc = new MachineService(
      { current: ctrl } as { current: LaserController },
      { current: port } as { current: SerialPortLike | null },
    );
    const unsub = svc.attachAutoFinalize(ctrl);
    (ctrl as unknown as { safetyOff: () => Promise<{ stage: 'soft-reset' }> }).safetyOff = async () => ({
      stage: 'soft-reset' as const,
    });

    void ctrl.sendJob(['G1 X10 F1000']);
    await flush(10);
    assert(ctrl.isJobRunning === true, 'sanity: controller job is running before error');
    port.injectResponse('error:9');
    await flush(60);

    assert(
      svc.getLaserOutputState() === 'unknown',
      "active-job error soft-reset safetyOff outcome routes to laserOutputState='unknown'",
    );
    assert(
      svc.getRecoveryState().status !== 'none',
      'active-job error soft-reset safetyOff outcome triggers recovery',
    );
    unsub();
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await makeConnectedGrbl();
    const svc = new MachineService(
      { current: ctrl } as { current: LaserController },
      { current: port } as { current: SerialPortLike | null },
    );
    const unsub = svc.attachAutoFinalize(ctrl);
    (ctrl as unknown as { safetyOff: () => Promise<{ stage: 'failed'; error: Error }> }).safetyOff = async () => ({
      stage: 'failed' as const,
      error: new Error('mock safety-off failure'),
    });

    port.injectResponse('ALARM:1');
    await flush(60);

    assert(
      svc.getLaserOutputState() === 'unknown',
      "alarm failed safetyOff outcome routes to laserOutputState='unknown'",
    );
    assert(
      svc.getRecoveryState().status !== 'none',
      'alarm failed safetyOff outcome triggers recovery',
    );
    unsub();
    await ctrl.disconnect();
  }

  {
    await installProfile();
    const scene = createScene(120, 100, 'safety-off service start');
    const ticket = makeTicket(scene);
    const controller = controllerThatEmitsSafetyOutcomeDuringExecute();
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );

    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idleState,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
    await flush(30);

    assert(
      svc.getLaserOutputState() === 'unknown',
      "startValidatedJob arms safety-off forwarding without attachAutoFinalize",
    );
    assert(
      svc.getRecoveryState().status !== 'none',
      'service-level safety-off forwarding triggers recovery after start',
    );
  }

  setStorageForTest(null);
  resetDeviceProfilesForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetDeviceProfilesForTest();
  console.error(err);
  process.exit(1);
});
