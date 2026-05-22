/**
 * Service-level bed-size gate.
 *
 * UI preflight blocks unknown bed dimensions, but MachineService is the final
 * machine-control boundary. A direct caller must not be able to start a ticket
 * compiled against PipelineService's fallback bed size when neither the active
 * profile nor the connected controller reports real travel dimensions.
 *
 * Run: npx tsx tests/service-start-blocks-unknown-bed.test.ts
 */
import './e2e/helpers/e2eDeterministicIds';
import { makeTestFrameTicket } from './helpers/testFrameTicket';

import { MachineService } from '../src/app/MachineService';
import { compileGcode, type CompileGcodeResult } from '../src/app/PipelineService';
import type { ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import type { SerialPortLike } from '../src/communication/SerialPort';
import type {
  ControllerJobTicket,
  ControllerOutput,
  LaserController,
  MachineState,
} from '../src/controllers/ControllerInterface';
import { setActiveProfileId } from '../src/core/devices/DeviceProfile';
import { createScene, type Scene } from '../src/core/scene/Scene';
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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeScene(): Scene {
  const scene = createScene(300, 300, 'unknown-bed-service-gate');
  return addObject(scene, createRect(scene.layers[0].id, 20, 20, 40, 30, 'rect'));
}

function contextFromCompile(result: CompileGcodeResult): ActiveJobCanvasContext {
  return {
    canvasMoves: result.canvasMoves,
    canvasPlanBounds: result.canvasPlanBounds,
    machineTransform: result.machineTransform,
  };
}

function makeController(sendCalls: string[][]): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: 1000,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, ticket: ControllerJobTicket) => {
      if (output.kind === 'gcode-stream') {
        const lines: string[] = [];
        for await (const chunk of output.spool.open()) {
          lines.push(...chunk.lines);
          if (chunk.isLast) break;
        }
        sendCalls.push(lines);
      } else if (output.kind === 'gcode-lines') {
        sendCalls.push([...output.lines]);
      }
      return { id: ticket.ticketId, startedAt: 123 };
    },
    sendJob: async (lines: string[]) => {
      sendCalls.push([...lines]);
    },
    pause: () => ({ accepted: true, action: 'pause', message: 'ok' }),
    resume: async () => ({ accepted: true, action: 'resume', message: 'ok' }),
    stop: () => ({ accepted: true, action: 'stop', message: 'ok' }),
    emergencyStop: () => ({ accepted: true, action: 'emergency-stop', message: 'ok' }),
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    getMachineInfo: () => ({
      bedWidth: 0,
      bedHeight: 0,
      homingDir: 0,
      maxSpindle: 1000,
      laserMode: true,
      maxFeedX: 0,
      maxFeedY: 0,
      maxAccelX: 0,
      maxAccelY: 0,
    }),
  } as unknown as LaserController;
}

async function run(): Promise<void> {
  console.log('\n=== service start blocks unknown bed dimensions ===\n');

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  setActiveProfileId(null);

  const scene = makeScene();
  const compiled = await compileGcode(
    scene,
    'absolute',
    null,
    1000,
    'grbl',
    null,
    null,
    null,
    { gcodeMaterialization: 'ticket-only' },
  );
  if (!compiled) throw new Error('Expected compile result');

  const sendCalls: string[][] = [];
  const svc = new MachineService(
    { current: makeController(sendCalls) } as { current: LaserController },
    { current: null } as { current: SerialPortLike | null },
  );

  let message = '';
  try {
    await svc.startValidatedJob({
      ticket: compiled.ticket,
      frameTicket: makeTestFrameTicket(compiled.ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: contextFromCompile(compiled),
      currentStartMode: 'absolute',
      currentSavedOrigin: null,
      outputFormat: 'grbl',
    });
  } catch (err: unknown) {
    message = err instanceof Error ? err.message : String(err);
  }

  assert(
    /bed size|bed dimensions|machine bed/i.test(message),
    'startValidatedJob rejects when both profile and controller bed dimensions are unknown',
  );
  assert(sendCalls.length === 0, 'unknown-bed start rejection happens before any G-code streams');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
