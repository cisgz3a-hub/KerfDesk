/**
 * === FILE: /tests/simulation.test.ts ===
 *
 * Purpose:    Tests for the simulation engine: frame generation from
 *             Plans, correct position tracking, laser state transitions,
 *             time estimation, interpolation, and path extraction.
 *
 * Dependencies:
 *   - /src/core/plan/Simulation.ts
 *   - /src/core/plan/Plan.ts
 * Last updated: Phase 6, Step 23 — Simulation engine
 *
 * Run with: npx tsx tests/simulation.test.ts
 */

import {
  type Plan, type Move, type PlannedOperation,
  createEmptyPlan,
} from '../src/core/plan/Plan';
import {
  simulatePlan,
  interpolateFrames,
  extractLaserPath,
  getFrameAtTime,
  type SimulationResult,
} from '../src/core/plan/Simulation';

// ─── ASSERTIONS ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) < tol, `${msg} (got ${actual.toFixed(3)}, expected ${expected})`);
}

// ─── HELPER: BUILD A SQUARE CUT PLAN ─────────────────────────────

function makeSquarePlan(): Plan {
  const plan = createEmptyPlan('test-job');
  const moves: Move[] = [
    { type: 'setAir', on: true },
    { type: 'rapid', to: { x: 10, y: 10 } },
    { type: 'laserOn', power: 80 },
    { type: 'linear', to: { x: 110, y: 10 }, power: 80, speed: 600 },   // 100mm right
    { type: 'linear', to: { x: 110, y: 60 }, power: 80, speed: 600 },   // 50mm down
    { type: 'linear', to: { x: 10, y: 60 }, power: 80, speed: 600 },    // 100mm left
    { type: 'linear', to: { x: 10, y: 10 }, power: 80, speed: 600 },    // 50mm up (close)
    { type: 'laserOff' },
    { type: 'setAir', on: false },
  ];

  plan.operations.push({
    operationId: 'op-1',
    layerName: 'Cut',
    layerColor: '#E63E6D',
    passIndex: 0,
    moves,
  });

  return plan;
}

// ─── TEST: BASIC SIMULATION ──────────────────────────────────────

console.log('\n=== Test: Basic Simulation ===');

const plan = makeSquarePlan();
const result = simulatePlan(plan);

assert(result.frames.length > 0, `Frames generated (${result.frames.length})`);
assert(result.totalTime > 0, `Total time > 0 (${result.totalTime.toFixed(2)}s)`);
assert(result.totalDistance > 0, `Total distance > 0 (${result.totalDistance.toFixed(1)}mm)`);
assert(result.operationCount === 1, 'Operation count = 1');

// Cut distance = perimeter of 100×50 rectangle = 300mm
assertClose(result.cutDistance, 300, 0.1, 'Cut distance = 300mm (perimeter)');

// Rapid distance = from origin (0,0) to start (10,10) = ~14.14mm
assertClose(result.rapidDistance, Math.sqrt(200), 0.1, 'Rapid distance = ~14.14mm');

// ─── TEST: POSITION TRACKING ─────────────────────────────────────

console.log('\n=== Test: Position Tracking ===');

// Find frames at each corner of the square
const linearFrames = result.frames.filter(f => f.moveType === 'linear');
assert(linearFrames.length === 4, `4 linear frames (one per side), got ${linearFrames.length}`);

// After first linear: should be at (110, 10)
assertClose(linearFrames[0].x, 110, 0.001, 'After side 1: x = 110');
assertClose(linearFrames[0].y, 10, 0.001, 'After side 1: y = 10');

// After second linear: should be at (110, 60)
assertClose(linearFrames[1].x, 110, 0.001, 'After side 2: x = 110');
assertClose(linearFrames[1].y, 60, 0.001, 'After side 2: y = 60');

// After third linear: should be at (10, 60)
assertClose(linearFrames[2].x, 10, 0.001, 'After side 3: x = 10');
assertClose(linearFrames[2].y, 60, 0.001, 'After side 3: y = 60');

// After fourth linear: back to (10, 10)
assertClose(linearFrames[3].x, 10, 0.001, 'After side 4: x = 10 (closed)');
assertClose(linearFrames[3].y, 10, 0.001, 'After side 4: y = 10 (closed)');

// ─── TEST: LASER STATE ──────────────────────────────────────────

console.log('\n=== Test: Laser State Tracking ===');

// Initial frame: laser should be OFF
assert(result.frames[0].laserOn === false, 'Initial frame: laser OFF');

// Find laserOn frame
const laserOnFrame = result.frames.find(f => f.moveType === 'laserOn');
assert(laserOnFrame !== undefined, 'laserOn frame exists');
assert(laserOnFrame!.laserOn === true, 'laserOn frame: laser is ON');
assert(laserOnFrame!.power === 80, 'laserOn frame: power = 80');

// All linear frames should have laser ON
assert(linearFrames.every(f => f.laserOn), 'All linear frames: laser ON');
assert(linearFrames.every(f => f.power === 80), 'All linear frames: power = 80');

// Find laserOff frame
const laserOffFrame = result.frames.find(f => f.moveType === 'laserOff');
assert(laserOffFrame !== undefined, 'laserOff frame exists');
assert(laserOffFrame!.laserOn === false, 'laserOff frame: laser is OFF');

// laserOff comes AFTER all linears
const lastLinearTime = linearFrames[linearFrames.length - 1].time;
assert(laserOffFrame!.time >= lastLinearTime, 'laserOff after last linear');

// ─── TEST: TIMING ────────────────────────────────────────────────

console.log('\n=== Test: Timing ===');

// Frames should be in strictly non-decreasing time order
let timeSorted = true;
for (let i = 1; i < result.frames.length; i++) {
  if (result.frames[i].time < result.frames[i - 1].time) {
    timeSorted = false;
    break;
  }
}
assert(timeSorted, 'Frames in non-decreasing time order');

// First frame at time 0
assertClose(result.frames[0].time, 0, 0.001, 'First frame at t=0');

// Last frame time = total time
const lastFrame = result.frames[result.frames.length - 1];
assertClose(lastFrame.time, result.totalTime, 0.001, 'Last frame time = totalTime');

// Rapid should be fast (short time for ~14mm at 6000mm/min)
const rapidFrame = result.frames.find(f => f.moveType === 'rapid' && f.x > 0);
assert(rapidFrame !== undefined, 'Rapid frame exists');
assert(rapidFrame!.time < 1.0, `Rapid completes in < 1s (took ${rapidFrame!.time.toFixed(3)}s)`);

// ─── TEST: PROGRESS ──────────────────────────────────────────────

console.log('\n=== Test: Progress ===');

assertClose(result.frames[0].progress, 0, 0.001, 'First frame: progress = 0');
assertClose(lastFrame.progress, 1.0, 0.01, 'Last frame: progress ≈ 1.0');

// Progress should be monotonically non-decreasing
let progressMonotonic = true;
for (let i = 1; i < result.frames.length; i++) {
  if (result.frames[i].progress < result.frames[i - 1].progress - 0.001) {
    progressMonotonic = false;
    break;
  }
}
assert(progressMonotonic, 'Progress monotonically non-decreasing');

// ─── TEST: OPERATION METADATA ────────────────────────────────────

console.log('\n=== Test: Operation Metadata ===');

assert(linearFrames.every(f => f.operationName === 'Cut'), 'Linear frames carry operation name "Cut"');
assert(linearFrames.every(f => f.operationColor === '#E63E6D'), 'Linear frames carry layer color');
assert(linearFrames.every(f => f.operationIndex === 0), 'Linear frames: operationIndex = 0');

// ─── TEST: INTERPOLATION ─────────────────────────────────────────

console.log('\n=== Test: Frame Interpolation ===');

const interpolated = interpolateFrames(result, 100); // 100ms intervals
assert(interpolated.length > 0, `Interpolated frames generated (${interpolated.length})`);

// Interpolated frames should be evenly spaced (~100ms apart)
if (interpolated.length >= 3) {
  const dt = interpolated[1].time - interpolated[0].time;
  assertClose(dt, 0.1, 0.02, 'Interpolated frame interval ≈ 100ms');
}

// Interpolated positions should be between event frame positions
const midFrame = interpolated[Math.floor(interpolated.length / 2)];
assert(midFrame.x >= 0 && midFrame.x <= 120, `Mid-frame x in range (${midFrame.x.toFixed(1)})`);
assert(midFrame.y >= 0 && midFrame.y <= 70, `Mid-frame y in range (${midFrame.y.toFixed(1)})`);

// ─── TEST: PATH EXTRACTION ───────────────────────────────────────

console.log('\n=== Test: Laser Path Extraction ===');

const laserPath = extractLaserPath(result);

// Should have 4 segments (the 4 sides of the rectangle)
assert(laserPath.length === 4, `4 path segments (got ${laserPath.length})`);

// All segments should have the cut layer color
assert(laserPath.every(s => s.color === '#E63E6D'), 'All segments have cut color');

// All segments should have power 80
assert(laserPath.every(s => s.power === 80), 'All segments have power 80');

// First segment: (10,10) → (110,10)
assertClose(laserPath[0].from.x, 10, 0.001, 'Segment 1 from.x = 10');
assertClose(laserPath[0].to.x, 110, 0.001, 'Segment 1 to.x = 110');

// ─── TEST: GET FRAME AT TIME ─────────────────────────────────────

console.log('\n=== Test: Get Frame At Time ===');

// At time 0: should be at origin
const t0 = getFrameAtTime(result, 0);
assertClose(t0.x, 0, 0.001, 'At t=0: x = 0');
assertClose(t0.y, 0, 0.001, 'At t=0: y = 0');

// At total time: should be back at (10, 10) after close
const tEnd = getFrameAtTime(result, result.totalTime);
assertClose(tEnd.x, 10, 0.001, 'At t=end: x = 10');
assertClose(tEnd.y, 10, 0.001, 'At t=end: y = 10');

// At half the total time: should be somewhere along the perimeter
const tMid = getFrameAtTime(result, result.totalTime / 2);
assert(tMid.x >= 0 && tMid.x <= 120, `At t=mid: x in bounds (${tMid.x.toFixed(1)})`);
assert(tMid.y >= 0 && tMid.y <= 70, `At t=mid: y in bounds (${tMid.y.toFixed(1)})`);

// ─── TEST: MULTI-OPERATION PLAN ──────────────────────────────────

console.log('\n=== Test: Multi-Operation Simulation ===');

const multiPlan = createEmptyPlan('multi-test');
// Operation 1: engrave (fill lines)
multiPlan.operations.push({
  operationId: 'engrave-op',
  layerName: 'Engrave',
  layerColor: '#3B8BEB',
  passIndex: 0,
  moves: [
    { type: 'rapid', to: { x: 20, y: 20 } },
    { type: 'laserOn', power: 50 },
    { type: 'linear', to: { x: 80, y: 20 }, power: 50, speed: 3000 },
    { type: 'laserOff' },
    { type: 'rapid', to: { x: 80, y: 21 } },
    { type: 'laserOn', power: 50 },
    { type: 'linear', to: { x: 20, y: 21 }, power: 50, speed: 3000 },
    { type: 'laserOff' },
  ],
});

// Operation 2: cut outline
multiPlan.operations.push({
  operationId: 'cut-op',
  layerName: 'Cut',
  layerColor: '#E63E6D',
  passIndex: 0,
  moves: [
    { type: 'setAir', on: true },
    { type: 'rapid', to: { x: 10, y: 10 } },
    { type: 'laserOn', power: 80 },
    { type: 'linear', to: { x: 90, y: 10 }, power: 80, speed: 150 },
    { type: 'linear', to: { x: 90, y: 30 }, power: 80, speed: 150 },
    { type: 'linear', to: { x: 10, y: 30 }, power: 80, speed: 150 },
    { type: 'linear', to: { x: 10, y: 10 }, power: 80, speed: 150 },
    { type: 'laserOff' },
    { type: 'setAir', on: false },
  ],
});

const multiResult = simulatePlan(multiPlan);
assert(multiResult.operationCount === 2, 'Multi: 2 operations');
assert(multiResult.totalTime > 0, `Multi: total time > 0 (${multiResult.totalTime.toFixed(2)}s)`);

// Engrave frames should come before cut frames (engrave op is first)
const engraveFrames = multiResult.frames.filter(f => f.operationName === 'Engrave' && f.moveType === 'linear');
const cutFrames = multiResult.frames.filter(f => f.operationName === 'Cut' && f.moveType === 'linear');
assert(engraveFrames.length === 2, `Multi: 2 engrave linear frames`);
assert(cutFrames.length === 4, `Multi: 4 cut linear frames`);

const lastEngraveTime = engraveFrames[engraveFrames.length - 1].time;
const firstCutTime = cutFrames[0].time;
assert(lastEngraveTime < firstCutTime, 'Multi: engrave finishes before cut starts');

// Path extraction should show both colors
const multiPath = extractLaserPath(multiResult);
const engraveSegments = multiPath.filter(s => s.color === '#3B8BEB');
const cutSegments = multiPath.filter(s => s.color === '#E63E6D');
assert(engraveSegments.length === 2, 'Multi path: 2 engrave segments');
assert(cutSegments.length === 4, 'Multi path: 4 cut segments');

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
