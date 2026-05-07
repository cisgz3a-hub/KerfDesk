/**
 * activeJobCanvasContext cleared everywhere activeTicket is cleared.
 * Run: npx tsx tests/active-job-canvas-context-cleared.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { compileGcode } from '../src/app/PipelineService';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { type LaserController, type JobProgress, type MachineState } from '../src/controllers/ControllerInterface';
import {
  createBlankProfile,
  getActiveProfile,
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
    key(): string | null {
      return null;
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
  console.log('\n=== active job canvas context cleared ===\n');
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('CtxClear');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s0 = createScene(400, 300, 'X');
  const scene = addObject(s0, createRect(s0.layers[0].id, 1, 1, 5, 5));
  // T2-22-followup: pass profile snapshot so the ticket's profileHash
  // matches the active profile at startValidatedJob time. Pre-T1-58
  // compileGcode read getActiveProfile() internally; post-T1-58 the
  // caller must thread the profile explicitly.
  const compiled = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null, getActiveProfile());
  assert(compiled != null, 'compile');
  if (!compiled) process.exit(1);
  const cctx: ActiveJobCanvasContext = {
    canvasMoves: compiled.canvasMoves,
    canvasPlanBounds: compiled.canvasPlanBounds,
    machineTransform: compiled.machineTransform,
  };

  {
    const sendThrows = { current: false };
    const mock = {
      protocolName: 'm',
      state: idle,
      isJobRunning: true,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      executeJob: async (_output, jobTicket) => {
        if (sendThrows.current) {
          throw new Error('stream failure');
        }
        return { id: jobTicket.ticketId, startedAt: 123 };
      },
      sendJob: async () => {
        if (sendThrows.current) {
          throw new Error('stream failure');
        }
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
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    sendThrows.current = true;
    let err = '';
    try {
      await svc.startValidatedJob({
        ticket: compiled.ticket,
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: cctx,
      });
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : String(e);
    }
    assert(err.length > 0, 'executeJob error propagates');
    assert(svc.getActiveJobCanvasContext() === null, 'context cleared in startValidatedJob catch');
  }

  {
    const mock = {
      protocolName: 'm',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      executeJob: async (_output, jobTicket) => ({ id: jobTicket.ticketId, startedAt: 123 }),
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
    } as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket: compiled.ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: cctx,
    });
    assert(svc.getActiveJobCanvasContext() != null, 'context set');

    const progress: JobProgress = {
      linesSent: 1,
      linesAcknowledged: 1,
      totalLines: 1,
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
    await svc.tryFinalizeJobLog(idle, zeroProgress, true, () => {});
    await svc.tryFinalizeJobLog(idle, progress, false, () => {});

    assert(
      svc.getActiveJobCanvasContext() === null,
      'getActiveJobCanvasContext null after tryFinalizeJobLog',
    );
  }

  {
    const mock = {
      protocolName: 'm',
      state: idle,
      isJobRunning: true,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      executeJob: async (_output, jobTicket) => ({ id: jobTicket.ticketId, startedAt: 123 }),
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
    } as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    await svc.startValidatedJob({
      ticket: compiled.ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: cctx,
    });
    assert(svc.getActiveJobCanvasContext() != null, 'context set again');
    svc.clearJobSession();
    assert(
      svc.getActiveJobCanvasContext() === null,
      'getActiveJobCanvasContext null after clearJobSession',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
