/**
 * T3-2 case 3: stale G-code cannot be started after the design changes.
 * Run: npx tsx tests/stale-gcode-blocks-start.test.ts
 */
import './e2e/helpers/e2eDeterministicIds';

import { MachineService } from '../src/app/MachineService';
import { compileGcode, type CompileGcodeResult } from '../src/app/PipelineService';
import type { ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import type {
  ControllerJobTicket,
  ControllerOutput,
  LaserController,
  MachineState,
} from '../src/controllers/ControllerInterface';
import type { SerialPortLike } from '../src/communication/SerialPort';
import { createBlankProfile, getActiveProfile, saveDeviceProfile, setActiveProfileId } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const memoryStore: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const key of Object.keys(memoryStore)) delete memoryStore[key];
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

function canvasContextFromCompile(result: CompileGcodeResult): ActiveJobCanvasContext {
  return {
    canvasMoves: result.canvasMoves,
    canvasPlanBounds: result.canvasPlanBounds,
    machineTransform: result.machineTransform,
  };
}

function makeIdleState(): MachineState {
  return {
    status: 'idle',
    position: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    alarmCode: null,
    errorCode: null,
  };
}

function makeController(executeCalls: ControllerOutput[]): LaserController {
  return {
    protocolName: 'mock',
    state: makeIdleState(),
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      executeCalls.push(output);
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

async function run(): Promise<void> {
  console.log('\n=== stale-gcode-blocks-start ===\n');

  installMockLocalStorage();
  for (const key of Object.keys(memoryStore)) delete memoryStore[key];

  const profile = createBlankProfile('T3-2 stale start');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  const scene0 = createScene(400, 300, 'stale start');
  const sceneAtCompile = addObject(
    scene0,
    createRect(scene0.layers[0].id, 20, 20, 40, 30, 'compiled-rect'),
  );
  const compiled = await compileGcode(
    sceneAtCompile,
    'current',
    null,
    null,
    'grbl',
    null,
    null,
    getActiveProfile(),
  );
  if (!compiled) throw new Error('Expected compile result');

  const sceneAfterEdit = addObject(
    sceneAtCompile,
    createRect(sceneAtCompile.layers[0].id, 100, 20, 20, 20, 'new-rect-after-compile'),
  );

  const executeCalls: ControllerOutput[] = [];
  const controllerRef = { current: makeController(executeCalls) } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const service = new MachineService(controllerRef, portRef);

  let errorMessage = '';
  try {
    await service.startValidatedJob({
      ticket: compiled.ticket,
      scene: sceneAfterEdit,
      machineState: makeIdleState(),
      notifySimulatorTx: () => {},
      canvasContext: canvasContextFromCompile(compiled),
    });
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  assert(
    errorMessage.includes('The design changed after this G-code was created'),
    'mutated scene is rejected with user-facing stale-design message',
  );
  assert(!errorMessage.includes('hash'), 'stale-design message does not expose hash internals');
  assert(executeCalls.length === 0, 'stale ticket is not sent to executeJob');
  assert(service.getActiveTicket() === null, 'stale ticket does not become the active job ticket');
  assert(service.getActiveJobCanvasContext() === null, 'stale ticket does not pin active canvas context');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
