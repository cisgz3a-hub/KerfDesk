/**
 * startValidatedJob stores the same canvasContext object reference on MachineService.
 * Run: npx tsx tests/start-validated-job-passes-context.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { type ControllerOutput, type ControllerJobTicket, type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
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

void (async () => {
  console.log('\n=== startValidatedJob passes canvas context by reference ===\n');

  const plan = createEmptyPlan('ctx-ref');
  const machineTransform = {
    plan,
    offsetX: 0,
    offsetY: 0,
    flipReferenceY: 300,
    flipY: true,
    returnPosition: { x: 0, y: 0 },
  };
  const scene = createScene(100, 100, 'r');
  const profile = getActiveProfile();
  const gcodeText = 'G0 X1\nM5';
  const ticket: ValidatedJobTicket = {
    ticketId: 'tkt_ctx',
    sceneHash: hashSceneForTicket(scene),
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcodeText),
    gcodeLines: ['G0 X1', 'M5'],
    gcodeText,
    machinePlanBounds: { ...plan.bounds },
    machineTransform,
    controllerType: 'grbl',
    startMode: 'current',
    savedOrigin: null,
    createdAt: Date.now(),
  };

  const canvasContext: ActiveJobCanvasContext = {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    machineTransform,
  };

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

  await svc.startValidatedJob({
    ticket,
    scene,
    machineState: idle,
    notifySimulatorTx: () => {},
    canvasContext,
  });

  assert(
    svc.getActiveJobCanvasContext() === canvasContext,
    'MachineService holds the same ActiveJobCanvasContext object reference',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
