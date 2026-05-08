/**
 * "Start from laser head" on front-origin diode machines must preserve the
 * visual orientation of text. Canvas Y increases downward, while front-origin
 * machine Y increases toward the rear, so a canvas-down stroke from the head
 * anchor must emit a negative relative Y move.
 *
 * Run: npx tsx tests/current-head-front-origin-orientation.test.ts
 */
import { buildFrameCorners } from '../src/app/frameGcode';
import { applyMachineTransform, transformPointToMachine } from '../src/core/plan/MachineTransform';
import type { Job } from '../src/core/job/Job';
import type { Plan } from '../src/core/plan/Plan';
import { getOutputStrategy } from '../src/core/output/Output';
import '../src/core/output/GrblStrategy';

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
  id: 'head-mode-front-origin-plan',
  jobId: 'job-head-mode-front-origin',
  createdAt: '2026-05-08T00:00:00.000Z',
  operations: [{
    operationId: 'op',
    layerName: 'Engrave',
    layerColor: '#22d3ee',
    passIndex: 0,
    moves: [
      { type: 'rapid', to: { x: 10, y: 20 } },
      { type: 'laserOn', power: 30 },
      { type: 'linear', to: { x: 10, y: 70 }, power: 30, speed: 1000 },
      { type: 'laserOff' },
    ],
  }],
  stats: {
    totalDistanceMm: 50,
    rapidDistanceMm: 0,
    cutDistanceMm: 50,
    estimatedTimeSeconds: 3,
    moveCount: 4,
    operationCount: 1,
    passCount: 1,
  },
  bounds: { minX: 10, minY: 20, maxX: 10, maxY: 70 },
};

const job: Job = {
  id: 'job-head-mode-front-origin',
  name: 'Head mode orientation',
  createdAt: '2026-05-08T00:00:00.000Z',
  operations: [],
  bounds: { minX: 10, minY: 20, maxX: 10, maxY: 70 },
  metadata: {
    objectCount: 1,
    layerCount: 1,
    sourceProjectId: 'test',
  },
};

const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
const transformOpts = {
  startMode: 'current' as const,
  savedOrigin: null,
  originCorner: 'front-left' as const,
  bedHeightMm: 300,
  bedWidthMm: 400,
};

console.log('\n=== current head front-origin orientation ===\n');

{
  const topLeft = transformPointToMachine({ x: 10, y: 20 }, sceneBounds, transformOpts);
  const bottomLeft = transformPointToMachine({ x: 10, y: 70 }, sceneBounds, transformOpts);
  assertClose(topLeft.y, 0, 'head/front-left top anchor is local Y0');
  assertClose(bottomLeft.y, -50, 'head/front-left canvas-down maps to negative machine Y');
}

{
  const result = applyMachineTransform(plan, transformOpts);
  const linear = result.plan.operations[0].moves.find(m => m.type === 'linear');
  assert(linear?.type === 'linear', 'transformed burn move exists');
  if (linear?.type === 'linear') {
    assertClose(linear.to.y, -50, 'transformed burn move is negative Y from the head anchor');
  }
}

{
  const corners = buildFrameCorners(sceneBounds, transformOpts);
  assertClose(corners[0].y, 0, 'frame starts at local top edge');
  assertClose(corners[2].y, -50, 'frame lower edge uses negative Y in head/front-left mode');
}

{
  const result = applyMachineTransform(plan, transformOpts);
  const strategy = getOutputStrategy('grbl');
  assert(strategy != null, 'GRBL strategy is registered');
  if (strategy) {
    const output = strategy.generate(result.plan, job, {
      startMode: 'current',
      maxSpindle: 1000,
      clock: () => '2026-05-08T00:00:00.000Z',
    });
    const text = output.text ?? '';
    const burnMove = text.split(/\r?\n/).find(line => /^G1\b/.test(line) && /\bS300\b/.test(line));
    assert(burnMove != null, 'relative burn G1 line emitted');
    if (burnMove) {
      assert(/\bY-50\.000\b/.test(burnMove), `relative burn move goes negative Y, got: ${burnMove}`);
      assert(!/\bY50\.000\b/.test(burnMove), `relative burn move must not go positive Y, got: ${burnMove}`);
    }
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
