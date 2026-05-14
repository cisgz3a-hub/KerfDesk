/**
 * Runtime JobFingerprint enforcement.
 *
 * The T2-85 fingerprint helper is not enough by itself: start must refuse
 * when the current runtime assumptions differ from the compiled artifact.
 *
 * Run: npx tsx tests/job-fingerprint-start-validation.test.ts
 */
import './e2e/helpers/e2eDeterministicIds';
import { makeTestFrameTicket } from './helpers/testFrameTicket';

import { MachineService } from '../src/app/MachineService';
import {
  buildPipelineJobFingerprint,
  compileGcode,
  type CompileGcodeResult,
} from '../src/app/PipelineService';
import { validateJobTicket } from '../src/app/validateJobTicket';
import type { ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import type { SerialPortLike } from '../src/communication/SerialPort';
import {
  createBlankProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import type { JobFingerprint } from '../src/core/job/JobFingerprint';
import type { ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';
import type {
  ControllerJobTicket,
  ControllerOutput,
  LaserController,
  MachineState,
} from '../src/controllers/ControllerInterface';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeScene(name: string): Scene {
  const base = createScene(400, 300, name);
  return addObject(base, createRect(base.layers[0].id, 20, 30, 50, 20, `${name}-rect`));
}

function makeFingerprint(
  scene: Scene,
  args: {
    startMode?: 'absolute' | 'current' | 'savedOrigin';
    savedOrigin?: { x: number; y: number } | null;
    controllerMaxSpindle?: number | null;
    machineBedFromController?: { width: number; height: number } | null;
  } = {},
): JobFingerprint {
  return buildPipelineJobFingerprint({
    scene,
    startMode: args.startMode ?? 'absolute',
    savedOrigin: args.savedOrigin ?? null,
    profile: getActiveProfile(),
    controllerMaxSpindle: args.controllerMaxSpindle ?? 1000,
    outputFormat: 'grbl',
    machineBedFromController: args.machineBedFromController ?? { width: 400, height: 300 },
    controllerAccelMmPerS2: null,
  });
}

function contextFromCompile(result: CompileGcodeResult): ActiveJobCanvasContext {
  return {
    canvasMoves: result.canvasMoves,
    canvasPlanBounds: result.canvasPlanBounds,
    machineTransform: result.machineTransform,
  };
}

function makeMockController(sendCalls: string[][]): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: 1000,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, ticket: ControllerJobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      sendCalls.push([...output.lines]);
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
      bedWidth: 400,
      bedHeight: 300,
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
  console.log('\n=== job fingerprint start validation ===\n');

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('Fingerprint Start');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  profile.maxSpindle = 1000;
  profile.originCorner = 'front-left';
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  const scene = makeScene('fingerprint-start');
  const compiled = await compileGcode(scene, 'absolute', null, 1000, 'grbl', { width: 400, height: 300 }, null, getActiveProfile());
  if (!compiled) throw new Error('Expected compile result');

  assert(
    (compiled.ticket as ValidatedJobTicket & { fingerprint?: JobFingerprint }).fingerprint != null,
    'compileGcode embeds JobFingerprint in the ticket',
  );

  const ticketWithFingerprint = {
    ...compiled.ticket,
    fingerprint: makeFingerprint(scene),
  } as ValidatedJobTicket & { fingerprint: JobFingerprint };

  const changedStartMode = makeFingerprint(scene, { startMode: 'current' });
  const directValidation = validateJobTicket({
    ticket: ticketWithFingerprint,
    scene,
    currentProfile: getActiveProfile(),
    currentControllerType: 'grbl',
    currentFingerprint: changedStartMode,
  } as Parameters<typeof validateJobTicket>[0] & { currentFingerprint: JobFingerprint });

  assert(
    !directValidation.ok && directValidation.reason.includes('start mode changed after compile'),
    'validateJobTicket rejects a current start mode that differs from the compiled fingerprint',
  );

  const changedOriginValidation = validateJobTicket({
    ticket: ticketWithFingerprint,
    scene,
    currentProfile: getActiveProfile(),
    currentControllerType: 'grbl',
    currentFingerprint: makeFingerprint(scene, { savedOrigin: { x: 12, y: 34 } }),
  } as Parameters<typeof validateJobTicket>[0] & { currentFingerprint: JobFingerprint });
  assert(
    !changedOriginValidation.ok && changedOriginValidation.reason.includes('saved origin changed after compile'),
    'validateJobTicket rejects a saved origin that differs from the compiled fingerprint',
  );

  const changedMaxSpindleValidation = validateJobTicket({
    ticket: ticketWithFingerprint,
    scene,
    currentProfile: getActiveProfile(),
    currentControllerType: 'grbl',
    currentFingerprint: makeFingerprint(scene, { controllerMaxSpindle: 900 }),
  } as Parameters<typeof validateJobTicket>[0] & { currentFingerprint: JobFingerprint });
  assert(
    !changedMaxSpindleValidation.ok && changedMaxSpindleValidation.reason.includes('machine capabilities changed after compile'),
    'validateJobTicket rejects a controller max-spindle snapshot that differs from compile',
  );

  const changedBedValidation = validateJobTicket({
    ticket: ticketWithFingerprint,
    scene,
    currentProfile: getActiveProfile(),
    currentControllerType: 'grbl',
    currentFingerprint: makeFingerprint(scene, { machineBedFromController: { width: 410, height: 300 } }),
  } as Parameters<typeof validateJobTicket>[0] & { currentFingerprint: JobFingerprint });
  assert(
    !changedBedValidation.ok && changedBedValidation.reason.includes('machine capabilities changed after compile'),
    'validateJobTicket rejects a bed-size snapshot that differs from compile',
  );

  const compileOptionScene = {
    ...scene,
    compileOptions: { optimizeOrder: false },
  } as Scene;
  const changedCompileOptionValidation = validateJobTicket({
    ticket: ticketWithFingerprint,
    scene,
    currentProfile: getActiveProfile(),
    currentControllerType: 'grbl',
    currentFingerprint: makeFingerprint(compileOptionScene),
  } as Parameters<typeof validateJobTicket>[0] & { currentFingerprint: JobFingerprint });
  assert(
    !changedCompileOptionValidation.ok,
    'validateJobTicket rejects compile-option drift through the runtime fingerprint',
  );

  const { fingerprint: _removedFingerprint, ...ticketWithoutFingerprint } = compiled.ticket;
  void _removedFingerprint;
  const missingFingerprintValidation = validateJobTicket({
    ticket: ticketWithoutFingerprint as ValidatedJobTicket,
    scene,
    currentProfile: getActiveProfile(),
    currentControllerType: 'grbl',
    currentFingerprint: makeFingerprint(scene),
  } as Parameters<typeof validateJobTicket>[0] & { currentFingerprint: JobFingerprint });

  assert(
    !missingFingerprintValidation.ok && missingFingerprintValidation.reason.includes('missing a job fingerprint'),
    'validateJobTicket rejects a ticket with no embedded JobFingerprint when runtime fingerprint is supplied',
  );

  const sendCalls: string[][] = [];
  const controller = makeMockController(sendCalls);
  const svc = new MachineService(
    { current: controller } as { current: LaserController },
    { current: null } as { current: SerialPortLike | null },
  );

  let startError = '';
  try {
    await svc.startValidatedJob({
      ticket: ticketWithFingerprint,
      frameTicket: makeTestFrameTicket(ticketWithFingerprint),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: contextFromCompile(compiled),
      currentStartMode: 'current',
      currentSavedOrigin: null,
      outputFormat: 'grbl',
    } as Parameters<MachineService['startValidatedJob']>[0] & {
      currentStartMode: 'current';
      currentSavedOrigin: null;
      outputFormat: 'grbl';
    });
  } catch (err: unknown) {
    startError = err instanceof Error ? err.message : String(err);
  }

  assert(
    startError.includes('start mode changed after compile'),
    'MachineService.startValidatedJob rejects when runtime start mode changed after compile',
  );
  assert(sendCalls.length === 0, 'runtime fingerprint mismatch does not stream G-code');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
