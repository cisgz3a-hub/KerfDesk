/**
 * T1-88 regression test: job replay capture must work for free-tier users.
 *
 * Bug: src/app/MachineService.ts:463 wrapped createReplay in
 * `if (requireFeature('job_replay'))`. Free users got only the basic
 * JobLog (compacted RX/TX, ~25 first / 25 last entries). Pro users
 * additionally got the richer JobReplay capture. Diagnostic capture for
 * support was gated behind Pro — meaning the users who often need more
 * help got less data when contacting support, undermining both fairness
 * and conversion.
 *
 * Fix: remove the capture gate entirely. Replay is now always-on (free +
 * Pro). The roadmap's intended split:
 *  - capture (always-on)
 *  - visualization (Pro-only, gated at the consumer side when built)
 *  - export (always-on, user-data-sovereignty for support bundles)
 *
 * For T1-88's first ship, only the capture-side change lands. The viewer/
 * export UI features don't exist yet; their gates are out of scope.
 *
 * This test verifies the capture gate is gone by running a job as a free-
 * tier user (the default in tsx test environment with no Pro override),
 * triggering a sendJob throw, and confirming a replay was persisted via
 * the T1-87 catch path. Pre-T1-88 this would persist 0 replays; post-T1-88
 * it persists 1.
 *
 * Run: npx tsx tests/job-replay-capture-not-gated.test.ts
 */
export {};

import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type ControllerOutput,
  type ControllerJobTicket,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { getActiveProfile } from '../src/core/devices/DeviceProfile';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
import { createScene } from '../src/core/scene/Scene';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { resetJobLogsForTest } from '../src/core/job/JobLog';
import { loadReplays } from '../src/core/replay/JobReplay';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';
import { makeTestFrameTicket } from './helpers/testFrameTicket';

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
    get length() { return Object.keys(memoryStore).length; },
    clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      return Object.keys(memoryStore)[index] ?? null;
    },
    removeItem(key: string): void { delete memoryStore[key]; },
    setItem(key: string, value: string): void { memoryStore[key] = value; },
  } as Storage;
}

function makeTicket(scene: ReturnType<typeof createScene>): ValidatedJobTicket {
  const plan = createEmptyPlan('replay-capture-test');
  const profile = getActiveProfile();
  return {
    ticketId: 'tkt_replay_capture',
    sceneHash: hashSceneForTicket(scene),
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
    emittedBurnBounds: null,
    burnEnvelopeDivergence: null,
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString('G0 X1\nM5'),
    fingerprint: makeTestJobFingerprint({
      scene,
      profile,
      startMode: 'current',
      savedOrigin: null,
    }),
    gcodeLines: ['G0 X1', 'M5'],
    gcodeText: 'G0 X1\nM5',
    machinePlanBounds: { ...plan.bounds },
    machineTransform: {
      plan,
      offsetX: 0,
      offsetY: 0,
      flipReferenceY: 300,
      flipY: true,
      returnPosition: { x: 0, y: 0 },
    },
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

function makeController(sendJob: (lines: string[]) => Promise<void>): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      await sendJob([...output.lines]);
      return { id: jobTicket.ticketId, startedAt: 123 };
    },
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
  } as unknown as LaserController;
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

void (async () => {
  console.log('\n=== job replay capture not gated (T1-88) ===\n');
  installMockLocalStorage();

  // Confirm starting from clean entitlement state. The tsx test environment
  // has no import.meta.env (no DEV/PROD signal) and no Pro license stored,
  // so the EntitlementService defaults to free tier. Any Pro-gated capture
  // path would skip; any always-on path would fire.
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetJobLogsForTest();

  const scene = createScene(120, 100, 'replay-capture');
  const ticket = makeTicket(scene);
  const controller = makeController(async () => {
    throw new Error('triggered to verify replay was created');
  });
  const svc = new MachineService(
    { current: controller } as { current: LaserController },
    { current: null } as { current: SerialPortLike | null },
  );

  let propagated = '';
  try {
    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
  } catch (e: unknown) {
    propagated = e instanceof Error ? e.message : String(e);
  }

  // 1. The throw still propagates (existing contract from T1-87).
  assert(
    propagated === 'triggered to verify replay was created',
    'sendJob throw propagates',
  );

  await drainMicrotasks();

  // 2. T1-88 core assertion: replay exists in storage. Pre-T1-88, free
  // users got 0 replays because createReplay was Pro-gated. Post-T1-88,
  // capture is always-on, so the T1-87 catch block has a real `replay`
  // ref to finalize and save.
  const replays = await loadReplays();
  assert(
    replays.length === 1,
    `T1-88: replay was captured for free-tier user (got ${replays.length})`,
  );

  const replay = replays[0]!;

  // 3. Replay carries the job's project name (from scene.metadata?.name).
  assert(
    replay.jobName === 'replay-capture',
    `replay.jobName matches scene name (got "${replay.jobName}")`,
  );

  // 4. Replay knows the total line count from the ticket.
  assert(
    replay.totalLines === ticket.gcodeLines.length,
    `replay.totalLines === ${ticket.gcodeLines.length} (got ${replay.totalLines})`,
  );

  // 5. T1-87 finalized this on the failure path; T2-67 widened the
  // status union and switched the failed-start path to use the distinct
  // 'failed_to_start' value (vs reusing 'failed' which is for mid-run
  // failures). The assertion below pins the post-T2-67 contract.
  assert(
    replay.status === 'failed_to_start',
    `replay.status === "failed_to_start" (T1-87 finalize + T2-67 enum widening; got "${replay.status}")`,
  );
  assert(
    replay.linesCompleted === 0,
    `replay.linesCompleted === 0 (T1-87 finalize)`,
  );

  // 6. completedAt is populated (proves finalizeReplay ran).
  assert(
    typeof replay.completedAt === 'string' && replay.completedAt.length > 0,
    'replay.completedAt populated (finalizeReplay ran)',
  );

  setStorageForTest(null);

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  setStorageForTest(null);
  console.error(err);
  process.exit(1);
});
