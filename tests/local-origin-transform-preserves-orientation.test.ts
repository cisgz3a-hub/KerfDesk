/**
 * Local workpiece modes (current head and saved zero) must not mirror the
 * artwork inside the local job box. Bed-origin mirroring belongs to absolute
 * canvas-position mode, where we map the on-screen bed grid to machine
 * coordinates. In local modes the user has already chosen the physical anchor.
 *
 * Run: npx tsx tests/local-origin-transform-preserves-orientation.test.ts
 */
import {
  applyMachineTransform,
  transformPointToMachine,
  type MachineTransformOptions,
} from '../src/core/plan/MachineTransform';
import type { Plan } from '../src/core/plan/Plan';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function assertClose(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.001, `${message} (actual=${actual}, expected=${expected})`);
}

const plan: Plan = {
  id: 'local-orientation-plan',
  jobId: 'job',
  operations: [{
    operationId: 'op',
    layerName: 'Engrave',
    moves: [
      { type: 'rapid', to: { x: 10, y: 20 } },
      { type: 'linear', to: { x: 10, y: 70 }, power: 30, speed: 1000 },
      { type: 'linear', to: { x: 110, y: 70 }, power: 30, speed: 1000 },
    ],
  }],
  bounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
} as Plan;

const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };

function opts(overrides: Partial<MachineTransformOptions>): MachineTransformOptions {
  return {
    startMode: 'current',
    savedOrigin: null,
    originCorner: 'front-left',
    bedHeightMm: 300,
    ...overrides,
  };
}

function moveTargets(result: ReturnType<typeof applyMachineTransform>) {
  return result.plan.operations[0].moves
    .filter((m): m is Extract<typeof m, { to: { x: number; y: number } }> => 'to' in m)
    .map(m => m.to);
}

console.log('\n=== local-origin transform preserves orientation ===\n');

{
  const result = applyMachineTransform(plan, opts({ startMode: 'current' }));
  const targets = moveTargets(result);
  assert(result.flipY === false, 'current/front-left reports no bed Y mirror');
  assertClose(targets[0].y, 0, 'current/front-left top point stays at local Y0');
  assertClose(targets[1].y, 50, 'current/front-left lower point stays below top point');
  assertClose(targets[2].x, 100, 'current/front-left right point stays right of left point');
}

{
  const result = applyMachineTransform(plan, opts({
    startMode: 'savedOrigin',
    savedOrigin: { x: 0, y: 0 },
  }));
  const targets = moveTargets(result);
  assert(result.flipY === false, 'savedOrigin/front-left reports no bed Y mirror');
  assertClose(targets[0].y, 0, 'savedOrigin/front-left top point stays at local Y0');
  assertClose(targets[1].y, 50, 'savedOrigin/front-left lower point stays below top point');
}

{
  const topLeft = transformPointToMachine(
    { x: 10, y: 20 },
    sceneBounds,
    opts({ startMode: 'current' }),
  );
  const bottomLeft = transformPointToMachine(
    { x: 10, y: 70 },
    sceneBounds,
    opts({ startMode: 'current' }),
  );
  assertClose(topLeft.y, 0, 'transformPointToMachine current top-left local Y0');
  assertClose(bottomLeft.y, 50, 'transformPointToMachine current bottom-left local Y50');
}

{
  const result = applyMachineTransform(plan, opts({
    startMode: 'current',
    originCorner: 'front-right',
    bedWidthMm: 400,
  }));
  const targets = moveTargets(result);
  assert(result.flipY === false, 'current/front-right reports no bed Y mirror');
  assertClose(targets[0].x, 0, 'current/front-right left point stays at local X0');
  assertClose(targets[2].x, 100, 'current/front-right right point stays right of left point');
}

{
  const result = applyMachineTransform(plan, opts({ startMode: 'absolute' }));
  const targets = moveTargets(result);
  assert(result.flipY === true, 'absolute/front-left still uses bed Y mirror');
  assertClose(targets[0].y, 280, 'absolute/front-left maps canvas top to back of 300mm bed');
  assertClose(targets[1].y, 230, 'absolute/front-left maps canvas bottom nearer the front');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
