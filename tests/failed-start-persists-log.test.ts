/**
 * T1-87 regression test: failed starts must persist a job log + replay.
 *
 * Bug: src/app/MachineService.ts catch block on a thrown sendJob silently
 * nullified currentJobLog and activeReplay before persisting. Support had
 * no record: which lines made it out before the throw, machine state at
 * start, the throw error itself — all gone. Failed starts are exactly
 * what support needs to investigate (often more diagnostic than completed
 * jobs, because they expose mismatches between app state and machine
 * state).
 *
 * Fix: before nullifying, finalize the partial log with status =
 * 'failed_to_start' + linesCompleted=0, add an 'error' entry with the
 * throw message, and fire-and-forget save it to storage. Same for the
 * replay. Save failures are caught and warned, never block cleanup or
 * the rethrow.
 *
 * T2-67 closed the original T1-87 stopgap: failed-start jobs are
 * finalized with the distinct 'failed_to_start' status (added to the
 * JobLog and JobReplay status unions) instead of reusing 'failed'.
 * This test asserts the new value.
 *
 * Run: npx tsx tests/failed-start-persists-log.test.ts
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
import {
  createBlankProfile,
  getActiveProfile,
  resetDeviceProfilesForTest,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
import { createScene } from '../src/core/scene/Scene';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { getJobLogs, resetJobLogsForTest } from '../src/core/job/JobLog';
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

// localStorage shim for code paths that consult it during migration.
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
  const plan = createEmptyPlan('failed-start-test');
  const profile = getActiveProfile();
  return {
    ticketId: 'tkt_failed_start',
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

function installActiveProfile(): void {
  resetDeviceProfilesForTest();
  const profile = createBlankProfile('Failed Start Log Test');
  profile.bedWidth = 120;
  profile.bedHeight = 100;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
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

/** Drain microtasks so fire-and-forget saves complete before assertions. */
async function drainMicrotasks(): Promise<void> {
  // saveJobLog → migrate → adapter writes are awaited internally but the
  // outer void/.catch leaves them on the microtask queue. Two ticks are
  // sufficient in practice; setTimeout(0) covers macrotask boundaries.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

void (async () => {
  console.log('\n=== failed-start persists log (T1-87) ===\n');
  installMockLocalStorage();

  // ── Scenario: sendJob throws → log + replay must be persisted ────────
  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetJobLogsForTest();
    installActiveProfile();

    const scene = createScene(120, 100, 'failed-start');
    const ticket = makeTicket(scene);
    const controller = makeController(async () => {
      throw new Error('controller buffer rejected first command');
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

    // 1. Throw still propagates (existing contract — must not regress).
    assert(
      propagated === 'controller buffer rejected first command',
      'thrown error from sendJob propagates to caller',
    );

    // Wait for the fire-and-forget saves to drain.
    await drainMicrotasks();

    // 2. State cleanup still happens (existing contract).
    assert(svc.getActiveTicket() === null, 'state cleanup: activeTicket cleared');
    assert(
      svc.getActiveJobCanvasContext() === null,
      'state cleanup: activeJobCanvasContext cleared',
    );

    // 3. The persisted job log exists and is well-formed.
    const logs = await getJobLogs();
    assert(logs.length === 1, `exactly one job log persisted (got ${logs.length})`);
    const log = logs[0]!;

    // 4. Status reflects failure-to-start (distinct from mid-run 'failed').
    assert(
      log.status === 'failed_to_start',
      `log.status === "failed_to_start" (got "${log.status}")`,
    );

    // 5. linesCompleted is zero — by definition the job didn't start.
    assert(
      log.linesCompleted === 0,
      `log.linesCompleted === 0 (got ${log.linesCompleted})`,
    );

    // 6. completedAt is set — proves finalizeLog ran.
    assert(
      typeof log.completedAt === 'string' && log.completedAt.length > 0,
      'log.completedAt populated (finalizeLog ran)',
    );

    // 7. Errors counter incremented — proves addLogEntry('error', ...) ran.
    assert(log.errors >= 1, `log.errors >= 1 (got ${log.errors})`);

    // 8. The error entry contains the throw message.
    const errEntries = log.entries.filter(e => e.type === 'error');
    assert(errEntries.length >= 1, 'at least one error entry recorded');
    const errMsg = errEntries[0]?.message ?? '';
    assert(
      /controller buffer rejected first command/.test(errMsg),
      `error entry contains the throw message (got: "${errMsg.slice(0, 80)}")`,
    );
    assert(
      /failed to start/i.test(errMsg),
      'error entry is labeled as a failed-start (not a generic error)',
    );

    // 9. The "Job started" milestone entry mentioning the ticket ID is
    // preserved (it was already in log.entries before the throw, via the
    // addLogEntry call in MachineService.startValidatedJob). Support uses
    // this to correlate failed-start logs with tickets — JobLog itself
    // doesn't carry ticketId as a structured field today (T2-67 may add it).
    const ticketMentions = log.entries.filter(e =>
      typeof e.message === 'string' && e.message.includes(ticket.ticketId),
    );
    assert(
      ticketMentions.length >= 1,
      `at least one entry mentions ticket ID ${ticket.ticketId} (got ${ticketMentions.length})`,
    );

    // 10. Replay was created and persisted. T1-88 made replay capture
    // always-on (no longer Pro-gated), so even in this test environment
    // with no entitlement, the activeReplay is created during
    // startValidatedJob and the new T1-87 catch block finalizes + saves it
    // when sendJob throws. Pre-T1-88 this assertion was the inverse
    // (replays.length === 0 because the gate prevented creation).
    const replays = await loadReplays();
    assert(
      replays.length === 1,
      `replay persisted on failed start (got ${replays.length})`,
    );
    const replay = replays[0]!;
    assert(
      replay.status === 'failed_to_start',
      `replay.status === "failed_to_start" (got "${replay.status}")`,
    );
    assert(
      replay.linesCompleted === 0,
      `replay.linesCompleted === 0 (got ${replay.linesCompleted})`,
    );

    setStorageForTest(null);
  }

  // ── Scenario 2: re-startable after failed start (existing contract) ──
  // The previous lifecycle test already covers this; we re-assert here in
  // the T1-87 context to prove the new finalize-and-save logic doesn't
  // break recovery.
  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetJobLogsForTest();

    const scene = createScene(120, 100, 'recovery');
    const ticket = makeTicket(scene);
    let shouldFail = true;
    const controller = makeController(async () => {
      if (shouldFail) throw new Error('first attempt fails');
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );

    try {
      await svc.startValidatedJob({
        ticket, scene, machineState: idle,
        frameTicket: makeTestFrameTicket(ticket),
        notifySimulatorTx: () => {},
        canvasContext: ctxFor(ticket),
        currentStartMode: ticket.startMode,
        currentSavedOrigin: ticket.savedOrigin,
      });
    } catch { /* expected */ }
    await drainMicrotasks();

    shouldFail = false;
    await svc.startValidatedJob({
      ticket, scene, machineState: idle,
      frameTicket: makeTestFrameTicket(ticket),
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
    assert(
      svc.getActiveTicket()?.ticketId === ticket.ticketId,
      'service can start a new job after a failed start',
    );

    setStorageForTest(null);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  setStorageForTest(null);
  console.error(err);
  process.exit(1);
});
