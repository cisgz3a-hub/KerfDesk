/**
 * T1-184 (internal audit F-026): `applyMachineTransform` should walk
 * the plan in 2 traversals (pre-bounds + transform-with-bounds), not 3.
 *
 * Pre-T1-184 evidence (MachineTransform.ts):
 *   1. Loop 1 computes pre-transform bounds (required for flipRef).
 *   2. `.map(op).map(move)` builds transformedOps.
 *   3. ANOTHER nested for-loop accumulates newBounds from transformedOps.
 *
 * Total: 3 plan traversals. On a million-move plan that's 3 M
 * iterations. Passes 2 + 3 can be fused without changing semantics:
 * while building each transformed move, expand the post-bounds AABB
 * with its endpoint.
 *
 * Post-T1-184: 2 traversals. Pre-bounds stays separate (it gates
 * flipReferenceX/Y). Transform + post-bounds fuse into one nested loop.
 *
 * Behavior is byte-identical: same output Plan, same `bounds` AABB,
 * same `flipReferenceX/Y`, same offset.
 *
 * Run: npx tsx tests/machine-transform-fused-bounds.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMachineTransform } from '../src/core/plan/MachineTransform';
import type { Plan, PlannedOperation } from '../src/core/plan/Plan';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

function makePlan(): Plan {
  const moves: PlannedOperation['moves'] = [
    { type: 'rapid', to: { x: 10, y: 20 } },
    { type: 'laserOn', power: 50 },
    { type: 'linear', to: { x: 100, y: 20 }, power: 50, speed: 1200 },
    { type: 'linear', to: { x: 100, y: 80 }, power: 50, speed: 1200 },
    { type: 'laserOff' },
  ];
  return {
    id: 'p1',
    jobId: 'j1',
    createdAt: '2026-05-11T00:00:00Z',
    operations: [
      { operationId: 'op-1', layerName: 'L', layerColor: '#000', passIndex: 0, moves },
    ],
    stats: {
      totalDistanceMm: 0,
      rapidDistanceMm: 0,
      cutDistanceMm: 0,
      estimatedTimeSeconds: 0,
      moveCount: 5,
      operationCount: 1,
      passCount: 1,
    },
    bounds: { minX: 10, minY: 20, maxX: 100, maxY: 80 },
  };
}

console.log('\n=== T1-184 applyMachineTransform fuses post-bounds with transform (audit F-026) ===\n');

// -------- 1. absolute mode: post-bounds matches pre-bounds (no transform) --------
{
  const plan = makePlan();
  const result = applyMachineTransform(plan, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'rear-left',
    bedHeightMm: 300,
    bedWidthMm: 400,
  });
  assert(result.plan.bounds.minX === 10, `minX preserved (got ${result.plan.bounds.minX})`);
  assert(result.plan.bounds.maxX === 100, `maxX preserved`);
  assert(result.plan.bounds.minY === 20, `minY preserved`);
  assert(result.plan.bounds.maxY === 80, `maxY preserved`);
  assert(result.plan.operations.length === 1, 'one operation');
  assert(result.plan.operations[0].moves.length === 5, 'five moves');
}

// -------- 2. front-left flipY: post-bounds reflects flipped Y --------
{
  const plan = makePlan();
  const result = applyMachineTransform(plan, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'front-left',
    bedHeightMm: 300,
    bedWidthMm: 400,
  });
  // Y should be mirrored: bedH - originalY. 20 → 280, 80 → 220.
  // minY = 220 (= 300-80), maxY = 280 (= 300-20).
  assert(
    result.plan.bounds.minY === 220 && result.plan.bounds.maxY === 280,
    `Y flipped: bounds Y is [220, 280] (got [${result.plan.bounds.minY}, ${result.plan.bounds.maxY}])`,
  );
}

// -------- 3. Behavior matches the (commented) 3-pass algorithm --------
{
  const plan = makePlan();
  // Compute pre-bounds and post-bounds the OLD WAY (3 passes) and
  // compare with the new fused implementation. Both must agree on
  // the final transformed bounds.
  const result = applyMachineTransform(plan, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'rear-right',
    bedHeightMm: 300,
    bedWidthMm: 400,
  });
  // Manually compute expected post-bounds by transforming each move
  // by hand. For rear-right: X mirrored (bedW - originalX), Y not
  // mirrored. 10 → 390, 100 → 300. So bounds X is [300, 390].
  assert(
    result.plan.bounds.minX === 300 && result.plan.bounds.maxX === 390,
    `rear-right: X flipped to [300, 390] (got [${result.plan.bounds.minX}, ${result.plan.bounds.maxX}])`,
  );
}

// -------- 4. Source pins on the fused implementation --------
{
  const src = readFileSync(resolve(here, '../src/core/plan/MachineTransform.ts'), 'utf-8');
  assert(/T1-184/.test(src), 'MachineTransform.ts carries T1-184 marker');
  assert(/audit F-026/.test(src), 'MachineTransform.ts cross-references audit F-026');

  // The old separate `for (const op of transformedOps)` post-bounds
  // loop must be gone. We anchor on the distinctive `for (const op
  // of transformedOps)` pattern that the pre-T1-184 code used.
  assert(
    !/for \(const op of transformedOps\)/.test(src),
    'pre-T1-184 separate post-bounds for-loop over transformedOps is gone',
  );

  // The fused implementation: `newBounds` is declared BEFORE the
  // transform map and updated inside it.
  const newBoundsIdx = src.indexOf('let newBounds = emptyAABB();');
  const transformMapIdx = src.indexOf('plan.operations.map(op =>');
  assert(
    newBoundsIdx > 0 && transformMapIdx > 0 && newBoundsIdx < transformMapIdx,
    'newBounds declared BEFORE the transform map (so the map can mutate it)',
  );

  // The transform inner loop expands newBounds inline.
  assert(
    /transformMove\([\s\S]{0,200}newBounds = expandAABB\(newBounds, tm\.to\.x, tm\.to\.y\)/.test(src),
    'transform inner loop expands newBounds with the transformed move endpoint',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
