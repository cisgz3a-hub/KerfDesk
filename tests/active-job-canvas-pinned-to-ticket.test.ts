/**
 * Active-job canvas display state should follow the running job's ticket, not a
 * fresh compile of the (possibly edited) scene.
 * Run: npx tsx tests/active-job-canvas-pinned-to-ticket.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { type Move } from '../src/core/plan/Plan';
import { type AABB } from '../src/core/types';
import { type MachineTransformResult } from '../src/core/plan/MachineTransform';

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

/** Mirrors App.tsx isJobRunning effect on the job-start edge. */
function syncActiveJobDisplayFromTicket(
  isJobRunning: boolean,
  wasJobRunning: boolean,
  getActiveTicket: () => ValidatedJobTicket | null,
): {
  canvasMoves: readonly Move[] | null;
  canvasPlanBounds: AABB | null;
  machineTransform: MachineTransformResult | null;
} {
  if (isJobRunning && !wasJobRunning) {
    const ticket = getActiveTicket();
    if (ticket) {
      return {
        canvasMoves: ticket.canvasMoves,
        canvasPlanBounds: ticket.canvasPlanBounds,
        machineTransform: ticket.machineTransform,
      };
    }
    return { canvasMoves: null, canvasPlanBounds: null, machineTransform: null };
  }
  if (!isJobRunning && wasJobRunning) {
    return { canvasMoves: null, canvasPlanBounds: null, machineTransform: null };
  }
  // No edge transition: caller does not update (matches App; not used in this test)
  return { canvasMoves: null, canvasPlanBounds: null, machineTransform: null };
}

void (async () => {
  console.log('\n=== active job canvas pinned to ticket ===\n');

  const memoryStore: Record<string, string> = {};
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
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const p = createBlankProfile('PinCanvas');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s0 = createScene(400, 300, 'P');
  const sceneA = addObject(s0, createRect(s0.layers[0].id, 10, 10, 50, 50));
  const rA = await compileGcode(sceneA, 'absolute', null, null, 'grbl', null, null);
  assert(rA != null, 'compile A');
  if (!rA) process.exit(1);
  const ticketA = rA.ticket;

  const s1 = createScene(400, 300, 'P2');
  const sceneB = addObject(s1, createRect(s1.layers[0].id, 200, 200, 20, 20));
  const rB = await compileGcode(sceneB, 'absolute', null, null, 'grbl', null, null);
  assert(rB != null, 'compile B (different scene)');
  if (!rB) process.exit(1);
  const ticketB = rB.ticket;

  assert(
    ticketA.ticketId !== ticketB.ticketId,
    'two jobs have distinct tickets',
  );

  // Job "starts" with ticketA still active in the service (simulated).
  const fromA = syncActiveJobDisplayFromTicket(true, false, () => ticketA);
  assert(
    fromA.machineTransform === ticketA.machineTransform,
    'display uses active ticket transform (job A)',
  );
  assert(
    fromA.canvasMoves === ticketA.canvasMoves,
    'display uses active ticket canvasMoves',
  );

  // If the service pointed at the wrong (newer) ticket, we'd get B.
  const fromWrong = syncActiveJobDisplayFromTicket(true, false, () => ticketB);
  assert(
    fromWrong.machineTransform === ticketB.machineTransform
    && fromWrong.machineTransform !== ticketA.machineTransform,
    'sanity: different ticket → different transform (would break if UI used latest compile instead of active job ticket)',
  );

  const cleared = syncActiveJobDisplayFromTicket(false, true, () => ticketA);
  assert(
    cleared.machineTransform === null && cleared.canvasMoves === null,
    'job end clears display state',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
