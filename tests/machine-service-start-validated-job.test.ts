/**
 * MachineService.startValidatedJob — ticket entry point.
 * Run: npx tsx tests/machine-service-start-validated-job.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort, type SerialPortLike } from '../src/communication/SerialPort';
import {
  type JobProgress,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { getJobLogs } from '../src/core/job/JobLog';

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

function flush(ms = 15): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitUntil(cond: () => boolean, timeoutMs: number, stepMs = 20): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await new Promise<void>(r => setTimeout(r, stepMs));
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

function makeTestTicket(overrides?: Partial<ValidatedJobTicket>): ValidatedJobTicket {
  const plan = createEmptyPlan('phase2-test');
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
  return {
    ticketId: 'tkt_phase2_test',
    sceneHash: 'scene-h',
    profileHash: 'profile-h',
    gcodeHash: 'gcode-h',
    gcodeLines: [...gcodeLines],
    gcodeText,
    machinePlanBounds: { ...plan.bounds },
    machineTransform,
    controllerType: 'grbl',
    startMode: 'current',
    savedOrigin: null,
    createdAt: Date.now(),
    ...overrides,
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

function makeMockController(sendJobImpl: (lines: string[]) => Promise<void>): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: sendJobImpl,
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
  } as LaserController;
}

async function run(): Promise<void> {
  console.log('\n=== machine-service startValidatedJob ===\n');

  const scene = createScene(120, 100, 'ticket svc test');
  const ticket = makeTestTicket();

  {
    const sentBatches: string[][] = [];
    const mock = makeMockController(async lines => {
      sentBatches.push([...lines]);
    });
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    const simLines: string[] = [];
    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: line => {
        simLines.push(line);
      },
    });

    assert(sentBatches.length === 1, 'sendJob invoked once');
    assert(
      sentBatches[0]?.join('\n') === [...ticket.gcodeLines].join('\n'),
      'sendJob receives ticket gcodeLines',
    );
    assert(
      simLines.join('\n') === [...ticket.gcodeLines].join('\n'),
      'notifySimulatorTx sees each ticket line',
    );
    assert(
      svc.getActiveTicket()?.ticketId === ticket.ticketId,
      'getActiveTicket returns the ticket after startValidatedJob',
    );
  }

  {
    installMockLocalStorage();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];

    const mock = makeMockController(async () => {});
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
    });

    const progress = {
      linesSent: 2,
      linesAcknowledged: 2,
      totalLines: 2,
      percentComplete: 100,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy',
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;

    svc.tryFinalizeJobLog(idle, progress, false, () => {});

    assert(svc.getActiveTicket() === null, 'getActiveTicket null after tryFinalizeJobLog');

    const logs = getJobLogs();
    assert(logs.length >= 1, 'job log persisted');
    const milestones = logs[0]?.entries.filter(e => e.type === 'milestone') ?? [];
    const startMilestone = milestones.find(m => m.message.includes('Job started:'));
    assert(
      Boolean(startMilestone?.message.includes(ticket.ticketId)),
      'start milestone includes ticketId',
    );
  }

  {
    const port = new MockSerialPort();
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush(30);

    const controllerRef = { current: ctrl as LaserController };
    const portRef = { current: port as SerialPortLike };
    const svc = new MachineService(controllerRef, portRef);

    const t = makeTestTicket({
      gcodeLines: ['G0 X1 Y1', 'M5'],
      gcodeText: 'G0 X1 Y1\nM5',
    });

    await svc.startValidatedJob({
      ticket: t,
      scene,
      machineState: ctrl.state,
      notifySimulatorTx: () => {},
    });

    await waitUntil(() => !ctrl.isJobRunning, 8000);

    assert(
      svc.getActiveTicket()?.ticketId === t.ticketId,
      'GrblController path: active ticket still set after job completes (until finalize)',
    );

    const progress = {
      linesSent: 2,
      linesAcknowledged: 2,
      totalLines: 2,
      percentComplete: 100,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy',
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;

    installMockLocalStorage();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];

    svc.tryFinalizeJobLog(ctrl.state, progress, ctrl.isJobRunning, () => {});
    assert(svc.getActiveTicket() === null, 'finalize clears ticket (Grbl path)');

    await ctrl.disconnect();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
