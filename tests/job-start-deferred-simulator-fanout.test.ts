/**
 * T1-46: notifySimulatorTx fan-out is deferred so executeJob starts streaming
 * BEFORE the per-line loop completes. Pre-T1-46:
 *
 *   for (const line of lines) notifySimulatorTx(line);  // sync, multi-second on big jobs
 *   await executeJob(output, ticket);                    // controller doesn't see byte 1 yet
 *
 * After T1-46:
 *
 *   const sendPromise = executeJob(output, ticket);      // controller starts streaming
 *   _notifySimulatorChunked(lines, notifySimulatorTx);   // chunked, deferred via setTimeout
 *   await sendPromise;                                    // resolves when stream finishes
 *
 * For a 2M-line job, the user-visible "click Start → laser begins" delay drops
 * from multi-second to <100ms because the controller's first byte goes out the
 * port immediately, while the simulator listeners catch up asynchronously.
 *
 * Run: npx tsx tests/job-start-deferred-simulator-fanout.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { createScene } from '../src/core/scene/Scene';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createEmptyPlan } from '../src/core/plan/Plan';
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

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length(): number { return Object.keys(memoryStore).length; },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
};

function makeMockController(onSendJob: (lines: string[]) => Promise<void>): LaserController {
  return {
    connect: async () => {},
    disconnect: async () => {},
    sendCommand: async () => {},
    executeJob: async (output, jobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      await onSendJob([...output.lines]);
      return { id: jobTicket.ticketId, startedAt: 123 };
    },
    sendJob: async (lines: string[]) => onSendJob(lines),
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    onObjectLifecycle: () => () => {},
    state: { status: 'idle', position: { x: 0, y: 0, z: 0 }, feedRate: 0, spindleSpeed: 0, alarmCode: null, errorCode: null },
    isJobRunning: false,
    maxSpindle: 1000,
    safetyOff: async () => ({ stage: 'm5' as const }),
    requestStatusReport: () => {},
    laserOnAt: () => {},
    laserOff: () => {},
  } as unknown as LaserController;
}

const idle: MachineState = {
  status: 'idle', position: { x: 0, y: 0, z: 0 },
  feedRate: 0, spindleSpeed: 0, alarmCode: null, errorCode: null,
};

const scene = createScene(120, 100, 'fanout test');

function makeBigTicket(lineCount: number): ValidatedJobTicket {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`G1 X${(i % 100).toFixed(2)} Y${(Math.floor(i / 100) % 80).toFixed(2)} F1000`);
  }
  const gcodeText = lines.join('\n');
  const plan = createEmptyPlan('fanout-test');
  const machineTransform = {
    plan,
    offsetX: 0,
    offsetY: 0,
    flipReferenceY: 100,
    flipY: true,
    returnPosition: { x: 0, y: 0 },
  };
  const profile = getActiveProfile();
  return {
    ticketId: 'fanout-' + lineCount,
    sceneHash: hashSceneForTicket(scene),
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcodeText),
    gcodeLines: lines,
    gcodeText,
    machinePlanBounds: { ...plan.bounds },
    machineTransform,
    controllerType: 'grbl',
    startMode: 'current',
    savedOrigin: null,
    createdAt: Date.now(),
  } as unknown as ValidatedJobTicket;
}

function ctxForTicket(ticket: ValidatedJobTicket): ActiveJobCanvasContext {
  return {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    machineTransform: ticket.machineTransform,
  };
}

console.log('\n=== T1-46 deferred simulator fan-out ===\n');

async function run(): Promise<void> {

// ── 1. executeJob is invoked BEFORE the simulator fan-out completes ──
{
  const events: string[] = [];
  const mock = makeMockController(async () => {
    events.push('executeJob-called');
  });
  const controllerRef = { current: mock } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);

  const ticket = makeBigTicket(50);  // small to keep the test fast
  let notifyCount = 0;
  await svc.startValidatedJob({
    ticket,
    scene,
    machineState: idle,
    notifySimulatorTx: () => {
      notifyCount++;
      events.push(`notify-${notifyCount}`);
    },
    canvasContext: ctxForTicket(ticket),
  });

  // The controller's executeJob mock pushes 'executeJob-called' synchronously when
  // invoked. T1-46 invokes it before scheduling notify chunks, so that event
  // must appear BEFORE any notify-N event.
  const sendIdx = events.indexOf('executeJob-called');
  const firstNotifyIdx = events.findIndex(e => e.startsWith('notify-'));
  assert(sendIdx >= 0, 'executeJob was called');
  assert(
    firstNotifyIdx === -1 || sendIdx < firstNotifyIdx,
    'T1-46: executeJob fired before any notifySimulatorTx (deferred fan-out)',
  );

  // Wait for the deferred chunks to drain.
  await new Promise(r => setTimeout(r, 200));
  assert(notifyCount === ticket.gcodeLines.length,
    `all ${ticket.gcodeLines.length} lines eventually notified (got ${notifyCount})`);
}

// ── 2. A throwing simulator listener does NOT break job start ──
{
  const mock = makeMockController(async () => {});
  const controllerRef = { current: mock } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);

  const ticket = makeBigTicket(20);
  let notifyAttempts = 0;
  let startError: unknown = null;
  try {
    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {
        notifyAttempts++;
        throw new Error('listener boom');
      },
      canvasContext: ctxForTicket(ticket),
    });
  } catch (e) {
    startError = e;
  }
  assert(startError === null, 'broken listener does not throw out of startValidatedJob');
  await new Promise(r => setTimeout(r, 100));
  assert(notifyAttempts === ticket.gcodeLines.length,
    'all lines were attempted even though every notify call threw');
}

// ── 3. Source-level pin: T1-46 marker + helper signature + chunked shape ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );

  assert(/T1-46/.test(src), 'T1-46 marker present in MachineService.ts');
  assert(
    /const sendPromise = this\.controllerRef\.current\.executeJob\([\s\S]{0,800}this\._notifySimulatorChunked/.test(src),
    'startValidatedJob: executeJob promise captured BEFORE _notifySimulatorChunked invocation',
  );
  assert(
    /private _notifySimulatorChunked\(\s*lines: string\[\],\s*notify:/.test(src),
    '_notifySimulatorChunked private helper declared with (lines, notify) signature',
  );
  assert(/setTimeout\(tick, 0\)/.test(src),
    '_notifySimulatorChunked yields between batches via setTimeout(..., 0)');
  assert(/NOTIFY_CHUNK = 1000/.test(src),
    '_notifySimulatorChunked uses 1000-line batches');

  // OLD shape gone.
  assert(
    !/for \(const line of lines\) notifySimulatorTx\(line\);/.test(src),
    'OLD synchronous per-line for-loop removed',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
