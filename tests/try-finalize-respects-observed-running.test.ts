/**
 * tryFinalizeJobLog must not "finalize" a job that was never observed running
 * (T1-11: stale idle+!running + running log at job start).
 * Run: npx tsx tests/try-finalize-respects-observed-running.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type JobProgress,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { getActiveProfile } from '../src/core/devices/DeviceProfile';

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
  const plan = createEmptyPlan('try-fin-obs');
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
    ticketId: 'tkt_try_fin_obs',
    sceneHash: hashSceneForTicket(scene),
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcodeText),
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

void (async () => {
  console.log('\n=== tryFinalize respects jobObservedRunning (no spurious finalize) ===\n');

  const scene = createScene(120, 100, 'obs-running');
  const ticket = makeTicket(scene);
  const cctx = ctxFor(ticket);

  const mock = {
    protocolName: 'm',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (_output, _jobTicket) => new Promise(() => {}),
    sendJob: async () => {
      return new Promise<void>(() => {});
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

  void svc.startValidatedJob({
    ticket,
    scene,
    machineState: idle,
    notifySimulatorTx: () => {},
    canvasContext: cctx,
  });
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    if (svc.getActiveJobCanvasContext() != null) break;
  }
  assert(
    svc.getActiveJobCanvasContext() === cctx,
    'hanging executeJob: canvas context is set and stable',
  );

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
  const messages: string[] = [];
  await svc.tryFinalizeJobLog(idle, progress, false, m => {
    messages.push(m);
  });

  assert(
    !messages.some(m => m.includes('log saved') || m.includes('Job log saved')),
    'no job log save message when job was never observed running',
  );
  assert(
    svc.getActiveJobCanvasContext() === cctx,
    'context still the same after no-op tryFinalize',
  );
  assert(svc.getActiveTicket()?.ticketId === ticket.ticketId, 'ticket still active');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
