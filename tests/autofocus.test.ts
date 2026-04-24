/**
 * Autofocus unit tests for MachineService + GrblController.
 * Run: npx tsx tests/autofocus.test.ts
 */

import { MachineService } from '../src/app/MachineService';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort, type SerialPortLike } from '../src/communication/SerialPort';
import type { LaserController } from '../src/controllers/ControllerInterface';
import {
  initializeDeviceProfiles,
  resetDeviceProfilesForTest,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function flush(ms = 15): Promise<void> {
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

function setActiveProfile(profile: DeviceProfile): void {
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
}

async function testMachineServiceAutoFocus(): Promise<void> {
  console.log('\n=== MachineService.autoFocus() ===');
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  setStorageForTest(new InMemoryStorageAdapter());
  resetDeviceProfilesForTest();
  await initializeDeviceProfiles();

  const calls: Array<{ command: string; timeoutMs: number }> = [];
  const controller = {
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
    sendJob: () => Promise.resolve(),
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
    onObjectLifecycle: () => () => {},
    runAutoFocus: async (command: string, timeoutMs: number = 15000) => {
      calls.push({ command, timeoutMs });
    },
  } as LaserController;

  const controllerRef = { current: controller } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);

  setActiveProfile({
    id: 'p1',
    name: 'No AF',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    machineType: 'diode',
    watts: 10,
    brand: 'Test',
    model: 'A',
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
    autoFocusSupported: false,
  });

  let result = await svc.autoFocus();
  assert(!result.ok && result.error.includes('not supported'), 'returns not-supported when profile disables autofocus');

  setActiveProfile({
    id: 'p2',
    name: 'Missing command',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    machineType: 'diode',
    watts: 10,
    brand: 'Test',
    model: 'B',
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
  });

  result = await svc.autoFocus();
  assert(!result.ok && result.error.includes('not supported'), 'returns not-supported when command is missing');

  // Non–Falcon A1 Pro: custom timeout is preserved. (Creality Falcon profiles
  // are healed to 15s on load; see backfillFalconAutofocus + falcon-autofocus-heal tests.)
  setActiveProfile({
    id: 'p3',
    name: 'With AF and custom timeout',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    machineType: 'diode',
    watts: 20,
    brand: 'Acme',
    model: 'Test Laser 9000',
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
    autoFocusTimeoutMs: 12345,
  });

  result = await svc.autoFocus();
  assert(result.ok, 'returns ok when controller autofocus succeeds');
  assert(calls.length === 1, 'calls controller autofocus exactly once');
  assert(calls[0].command === '$HZ1', 'passes configured autofocus command unchanged');
  assert(calls[0].timeoutMs === 12345, 'passes configured autofocus timeout');
}

async function connectGrbl(): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  return { ctrl, port };
}

async function testGrblRunAutoFocus(): Promise<void> {
  console.log('\n=== GrblController.runAutoFocus() ===');

  {
    const { ctrl } = await connectGrbl();
    (ctrl as unknown as { _state: { status: string } })._state.status = 'run';
    let threw = false;
    try {
      await ctrl.runAutoFocus('$HZ1', 500);
    } catch (e: unknown) {
      threw = e instanceof Error && e.message.includes('Machine not idle');
    }
    assert(threw, 'throws when machine is not idle');
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await connectGrbl();
    const p = ctrl.runAutoFocus('$HZ1', 1000);
    await flush();
    port.injectResponse('<Home|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    port.injectResponse('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    let resolved = false;
    await p.then(() => {
      resolved = true;
    });
    assert(resolved, 'resolves after Idle -> Home/Run -> Idle transition');
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await connectGrbl();
    const p = ctrl.runAutoFocus('$HZ1', 1000);
    await flush();
    // Non-standard Falcon status token should still count as active.
    port.injectResponse('<Focus|MPos:0.000,0.000,-2.000|FS:0,0>');
    await flush();
    port.injectResponse('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    let resolved = false;
    await p.then(() => {
      resolved = true;
    });
    assert(resolved, 'resolves when active phase uses unknown status token before idle');
    await ctrl.disconnect();
  }

  {
    const { ctrl } = await connectGrbl();
    let timedOut = false;
    try {
      await ctrl.runAutoFocus('$HZ1', 30);
    } catch (e: unknown) {
      timedOut = e instanceof Error && e.message.includes('timed out');
    }
    assert(timedOut, 'rejects on timeout when no active status is observed');
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await connectGrbl();
    const p = ctrl.runAutoFocus('$HZ1', 1000);
    await flush();
    port.injectResponse('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    let alarmRejected = false;
    try {
      await p;
    } catch (e: unknown) {
      alarmRejected = e instanceof Error && e.message.includes('Auto-focus alarm');
    }
    assert(alarmRejected, 'rejects when alarm state is observed');
    await ctrl.disconnect();
  }
}

async function runAll(): Promise<void> {
  await testMachineServiceAutoFocus();
  await testGrblRunAutoFocus();
  setStorageForTest(null);
  resetDeviceProfilesForTest();
  console.log(`\nAutofocus tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(e => {
  setStorageForTest(null);
  resetDeviceProfilesForTest();
  console.error(e);
  process.exit(1);
});
