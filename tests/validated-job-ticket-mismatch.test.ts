/**
 * startValidatedJob rejects stale/corrupted tickets before streaming.
 * Run: npx tsx tests/validated-job-ticket-mismatch.test.ts
 */
import './e2e/helpers/e2eDeterministicIds';

import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { type CompileGcodeResult } from '../src/app/PipelineService';
import { MachineService } from '../src/app/MachineService';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { compileGcode } from '../src/app/PipelineService';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';

function activeJobContextFromCompile(c: CompileGcodeResult): ActiveJobCanvasContext {
  return {
    canvasMoves: c.canvasMoves,
    canvasPlanBounds: c.canvasPlanBounds,
    machineTransform: c.machineTransform,
  };
}

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

function makeScene(name: string, x: number): ReturnType<typeof createScene> {
  const s0 = createScene(400, 300, name);
  return addObject(s0, createRect(s0.layers[0].id, x, 20, 40, 30, `${name}-rect`));
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

async function run(): Promise<void> {
  console.log('\n=== validated-job-ticket mismatch ===\n');

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profileA = createBlankProfile('Mismatch A');
  profileA.bedWidth = 400;
  profileA.bedHeight = 300;
  saveDeviceProfile(profileA);
  setActiveProfileId(profileA.id);

  const sendCalls: string[][] = [];
  const controller = {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async (lines: string[]) => {
      sendCalls.push([...lines]);
    },
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
  const controllerRef = { current: controller } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);

  {
    sendCalls.length = 0;
    setActiveProfileId(profileA.id);
    const sceneA = makeScene('SceneA', 20);
    const sceneB = makeScene('SceneB', 120);
    const compiledA = await compileGcode(sceneA, 'current', null, null, 'grbl', null, null);
    if (!compiledA) throw new Error('Expected compile result for sceneA');

    let errMsg = '';
    try {
      await svc.startValidatedJob({
        ticket: compiledA.ticket,
        scene: sceneB,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: activeJobContextFromCompile(compiledA),
      });
    } catch (err: unknown) {
      errMsg = err instanceof Error ? err.message : String(err);
    }

    assert(
      errMsg.includes('The design changed after this G-code was created'),
      'scene mismatch rejected',
    );
    assert(!errMsg.includes('hash'), 'scene mismatch: user-facing message hides hash details');
    assert(sendCalls.length === 0, 'scene mismatch: sendJob not called');
    assert(svc.getActiveTicket() === null, 'scene mismatch: activeTicket remains null');
  }

  {
    sendCalls.length = 0;
    setActiveProfileId(profileA.id);
    const scene = makeScene('ProfileMismatch', 40);
    const compiled = await compileGcode(scene, 'current', null, null, 'grbl', null, null);
    if (!compiled) throw new Error('Expected compile result for profile mismatch scene');

    const profileB = createBlankProfile('Mismatch B');
    profileB.bedWidth = 420;
    profileB.bedHeight = 320;
    saveDeviceProfile(profileB);
    setActiveProfileId(profileB.id);

    let errMsg = '';
    try {
      await svc.startValidatedJob({
        ticket: compiled.ticket,
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: activeJobContextFromCompile(compiled),
      });
    } catch (err: unknown) {
      errMsg = err instanceof Error ? err.message : String(err);
    }

    assert(
      errMsg.includes('The device profile changed after this G-code was created'),
      'profile mismatch rejected',
    );
    assert(!errMsg.includes('hash'), 'profile mismatch: user-facing message hides hash details');
    assert(sendCalls.length === 0, 'profile mismatch: sendJob not called');
    assert(svc.getActiveTicket() === null, 'profile mismatch: activeTicket remains null');
  }

  {
    sendCalls.length = 0;
    const profileClean = createBlankProfile('Clean');
    profileClean.bedWidth = 400;
    profileClean.bedHeight = 300;
    saveDeviceProfile(profileClean);
    setActiveProfileId(profileClean.id);

    const scene = makeScene('CleanPath', 60);
    const compiled = await compileGcode(scene, 'current', null, null, 'grbl', null, null);
    if (!compiled) throw new Error('Expected compile result for clean path');

    await svc.startValidatedJob({
      ticket: compiled.ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: activeJobContextFromCompile(compiled),
    });

    assert(sendCalls.length === 1, 'clean path: sendJob called once');
    assert(svc.getActiveTicket()?.ticketId === compiled.ticket.ticketId, 'clean path: activeTicket set');
    svc.clearJobSession();
  }

  {
    sendCalls.length = 0;
    const profileTamper = createBlankProfile('Tamper');
    profileTamper.bedWidth = 400;
    profileTamper.bedHeight = 300;
    saveDeviceProfile(profileTamper);
    setActiveProfileId(profileTamper.id);

    const scene = makeScene('GcodeCorrupt', 80);
    const compiled = await compileGcode(scene, 'current', null, null, 'grbl', null, null);
    if (!compiled) throw new Error('Expected compile result for gcode tamper');

    const tamperedTicket = {
      ...compiled.ticket,
      gcodeText: `${compiled.ticket.gcodeText}\nG4 P1`,
    };

    let errMsg = '';
    try {
      await svc.startValidatedJob({
        ticket: tamperedTicket,
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: activeJobContextFromCompile(compiled),
      });
    } catch (err: unknown) {
      errMsg = err instanceof Error ? err.message : String(err);
    }

    assert(errMsg.includes('gcode hash mismatch'), 'gcode corruption rejected');
    assert(sendCalls.length === 0, 'gcode corruption: sendJob not called');
    assert(svc.getActiveTicket() === null, 'gcode corruption: activeTicket remains null');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
