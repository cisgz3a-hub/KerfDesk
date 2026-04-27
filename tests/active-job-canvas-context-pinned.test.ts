/**
 * T1-11 v2: active job canvas context keeps the same object references for the
 * run (no identity churn from ticket or recompiles).
 * Run: npx tsx tests/active-job-canvas-context-pinned.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { type CompileGcodeResult } from '../src/app/PipelineService';
import { MachineService } from '../src/app/MachineService';
import { compileGcode } from '../src/app/PipelineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';

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

function contextFrom(c: CompileGcodeResult): ActiveJobCanvasContext {
  return {
    canvasMoves: c.canvasMoves,
    canvasPlanBounds: c.canvasPlanBounds,
    machineTransform: c.machineTransform,
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

function makeCtrl(sendJob: (lines: string[]) => Promise<void> = async () => {}): LaserController {
  return {
    protocolName: 'm',
    state: idle,
    isJobRunning: true,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
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

void (async () => {
  console.log('\n=== active job canvas context pinned (ref stability) ===\n');
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('CtxPin');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s0 = createScene(400, 300, 'C');
  let scene = addObject(s0, createRect(s0.layers[0].id, 1, 1, 10, 10));
  const first = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null);
  assert(first != null, 'first compile');
  if (!first) {
    process.exit(1);
  }
  const movesA = first.canvasMoves;
  const ctxA = contextFrom(first);

  const mock = makeCtrl();
  const controllerRef = { current: mock } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);

  await svc.startValidatedJob({
    ticket: first.ticket,
    scene,
    machineState: idle,
    notifySimulatorTx: () => {},
    canvasContext: ctxA,
  });

  const during = svc.getActiveJobCanvasContext();
  assert(during != null, 'context set during job');
  assert(
    during.canvasMoves === movesA,
    'getActiveJobCanvasContext.canvasMoves same array ref as at job start',
  );
  assert(
    during.machineTransform === first.machineTransform,
    'machineTransform ref stable',
  );

  // Simulate user editing scene and recompiling (new array identities)
  scene = addObject(scene, createRect(scene.layers[0].id, 200, 200, 5, 5));
  const second = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null);
  assert(second != null && second.canvasMoves !== movesA, 'recompile produces new move array');
  const during2 = svc.getActiveJobCanvasContext();
  assert(
    during2?.canvasMoves === movesA,
    'context still first compile arrays after unrelated recompile',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
