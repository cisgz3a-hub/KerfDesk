/**
 * Head mode (startMode=current): G91 relative XY/Z, delta G0/G1, footer return + G90.
 * Bed / savedOrigin: G90 absolute, unchanged shape.
 *
 * Run: npx tsx tests/gcode-relative-mode.test.ts
 */

import { createEmptyJob, type Job } from '../src/core/job/Job';
import { type Plan } from '../src/core/plan/Plan';
import { getOutputStrategy } from '../src/core/output/Output';
import '../src/core/output/GrblStrategy';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';

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

console.log('\n=== gcode-relative-mode ===');

const strategy = getOutputStrategy('grbl');
assert(!!strategy, 'GRBL strategy registered');

function rectangleJobAndPlan(withSpeedChange: boolean): { job: Job; plan: Plan } {
  const job: Job = createEmptyJob('rel-rect', 'tproj');
  job.operations.push({
    id: 'op1',
    layerId: 'l1',
    layerName: 'L',
    layerColor: '#fff',
    order: 0,
    type: 'cut',
    settings: {
      powerMin: 0,
      powerMax: 100,
      speed: 1000,
      passes: 1,
      zStepPerPass: 0,
      fillInterval: 0,
      fillAngle: 0,
      fillMode: 'line',
      fillBiDirectional: false,
      overscanning: 0,
      overcut: 0,
      leadIn: 0,
      tabCount: 0,
      tabWidth: 0,
      insideFirst: false,
      airAssist: false,
      accelAwarePower: false,
      maxAccelMmPerS2: 500,
      minPowerRatioAccel: 0.1,
      scanningOffsets: EMPTY_OFFSET_TABLE,
    },
    geometry: { type: 'vector', paths: [] },
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
  });

  const s2 = withSpeedChange ? 500 : 1000;
  const plan: Plan = {
    id: 'p-rect',
    jobId: job.id,
    createdAt: new Date().toISOString(),
    operations: [
      {
        operationId: 'op1',
        layerName: 'L',
        layerColor: '#fff',
        passIndex: 0,
        moves: [
          { type: 'rapid', to: { x: 0, y: 0 } },
          { type: 'laserOn', power: 50 },
          { type: 'linear', to: { x: 30, y: 0 }, power: 50, speed: 1000 },
          { type: 'linear', to: { x: 30, y: 20 }, power: 50, speed: s2 },
          { type: 'linear', to: { x: 0, y: 20 }, power: 50, speed: s2 },
          { type: 'linear', to: { x: 0, y: 0 }, power: 50, speed: s2 },
          { type: 'laserOff' },
        ],
      },
    ],
    stats: {
      totalDistanceMm: 0,
      rapidDistanceMm: 0,
      cutDistanceMm: 0,
      estimatedTimeSeconds: 0,
      moveCount: 0,
      operationCount: 1,
      passCount: 1,
    },
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
  };
  return { job, plan };
}

// ─── Head: header G91, not default absolute line ─────────────────────────
{
  const { job, plan } = rectangleJobAndPlan(false);
  const text = strategy!.generate(plan, job, { startMode: 'current', returnPosition: null }).text ?? '';
  const headerLines = text.split('\n').slice(0, 12).join('\n');
  assert(/\bG91\b.*relative positioning/i.test(headerLines), 'Head: header has G91 relative positioning');
  assert(!/G90 ; absolute positioning/i.test(headerLines), 'Head: default header block has no G90 absolute line');
}

// ─── Head: axis-aligned rectangle uses per-axis deltas (no full X Y on every G1) ───
{
  const { job, plan } = rectangleJobAndPlan(false);
  const text = strategy!.generate(plan, job, { startMode: 'current', returnPosition: null }).text ?? '';
  assert(text.includes('G1 X30.000'), 'Head: first cut segment is delta X30');
  assert(text.includes('G1 Y20.000'), 'Head: includes delta Y20');
  assert(text.includes('G1 X-30.000'), 'Head: includes delta X-30');
  assert(text.includes('G1 Y-20.000'), 'Head: includes delta Y-20');
}

// ─── Head: speed change emits new F on a later G1 ─────────────────────────
{
  const { job, plan } = rectangleJobAndPlan(true);
  const text = strategy!.generate(plan, job, { startMode: 'current', returnPosition: null }).text ?? '';
  assert(text.includes('F1000'), 'Head: includes F1000');
  assert(text.includes('F500'), 'Head: includes F500 after speed change');
}

// ─── Head: footer restores G90 ───────────────────────────────────────────
{
  const { job, plan } = rectangleJobAndPlan(false);
  const text = strategy!.generate(plan, job, { startMode: 'current', returnPosition: { x: 0, y: 0 } }).text ?? '';
  assert(text.includes('G90 ; restore absolute positioning'), 'Head: footer restores G90');
  const idxRestore = text.lastIndexOf('G90 ; restore absolute positioning');
  const idxM2 = text.lastIndexOf('M2');
  assert(idxRestore >= 0 && idxM2 > idxRestore, 'Head: G90 restore before M2');
}

// ─── Bed: G90 absolute in header, full absolute XY on G1 ─────────────────
{
  const { job, plan } = rectangleJobAndPlan(false);
  const text = strategy!.generate(plan, job, { startMode: 'absolute', returnPosition: null }).text ?? '';
  const headerLines = text.split('\n').slice(0, 12).join('\n');
  assert(/G90 ; (T2-14 safety baseline: )?absolute positioning/i.test(headerLines), 'Bed: header G90 absolute');
  assert(!/\bG91\b.*relative positioning/i.test(headerLines), 'Bed: header has no G91 relative line');
  assert(text.includes('G1 X30.000 Y0.000'), 'Bed: G1 uses absolute X Y pair');
}

// ─── savedOrigin: same header as Bed (G90 absolute) ───────────────────────
{
  const { job, plan } = rectangleJobAndPlan(false);
  const text = strategy!.generate(plan, job, {
    startMode: 'savedOrigin',
    savedOrigin: { x: 50, y: 50 },
    returnPosition: null,
  }).text ?? '';
  const headerLines = text.split('\n').slice(0, 12).join('\n');
  assert(/G90 ; (T2-14 safety baseline: )?absolute positioning/i.test(headerLines), 'savedOrigin: header G90 absolute');
  assert(!/\bG91\b.*relative positioning/i.test(headerLines), 'savedOrigin: header has no G91 relative line');
}

// ─── Head: OBJ marker still before first G1 ───────────────────────────────
{
  const job: Job = createEmptyJob('mk', 't');
  job.operations.push({
    id: 'op1',
    layerId: 'l1',
    layerName: 'L',
    layerColor: '#fff',
    order: 0,
    type: 'cut',
    settings: {
      powerMin: 0,
      powerMax: 100,
      speed: 1000,
      passes: 1,
      zStepPerPass: 0,
      fillInterval: 0,
      fillAngle: 0,
      fillMode: 'line',
      fillBiDirectional: false,
      overscanning: 0,
      overcut: 0,
      leadIn: 0,
      tabCount: 0,
      tabWidth: 0,
      insideFirst: false,
      airAssist: false,
      accelAwarePower: false,
      maxAccelMmPerS2: 500,
      minPowerRatioAccel: 0.1,
      scanningOffsets: EMPTY_OFFSET_TABLE,
    },
    geometry: { type: 'vector', paths: [] },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
  });
  const plan: Plan = {
    id: 'pm',
    jobId: job.id,
    createdAt: new Date().toISOString(),
    operations: [
      {
        operationId: 'op1',
        layerName: 'L',
        layerColor: '#fff',
        passIndex: 0,
        moves: [
          { type: 'marker', sourceObjectIds: ['obj-a'] },
          { type: 'rapid', to: { x: 0, y: 0 } },
          { type: 'laserOn', power: 50 },
          { type: 'linear', to: { x: 10, y: 0 }, power: 50, speed: 1000 },
          { type: 'laserOff' },
        ],
      },
    ],
    stats: {
      totalDistanceMm: 0,
      rapidDistanceMm: 0,
      cutDistanceMm: 0,
      estimatedTimeSeconds: 0,
      moveCount: 0,
      operationCount: 1,
      passCount: 1,
    },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
  };
  const text = strategy!.generate(plan, job, { startMode: 'current', returnPosition: null }).text ?? '';
  const lines = text.split('\n');
  const objIdx = lines.findIndex(l => /;\s*OBJ\s+ids=obj-a/i.test(l.trim()));
  const g1Idx = lines.findIndex(l => /^G1\b/i.test(l.trim()));
  assert(objIdx >= 0 && g1Idx >= 0 && objIdx < g1Idx, 'Head: OBJ comment precedes first G1');
}

// ─── Head: Z steps are relative deltas across passes ─────────────────────
{
  const job: Job = createEmptyJob('zpass', 't');
  job.operations.push({
    id: 'op1',
    layerId: 'l1',
    layerName: 'L',
    layerColor: '#fff',
    order: 0,
    type: 'cut',
    settings: {
      powerMin: 0,
      powerMax: 100,
      speed: 1000,
      passes: 1,
      zStepPerPass: 0,
      fillInterval: 0,
      fillAngle: 0,
      fillMode: 'line',
      fillBiDirectional: false,
      overscanning: 0,
      overcut: 0,
      leadIn: 0,
      tabCount: 0,
      tabWidth: 0,
      insideFirst: false,
      airAssist: false,
      accelAwarePower: false,
      maxAccelMmPerS2: 500,
      minPowerRatioAccel: 0.1,
      scanningOffsets: EMPTY_OFFSET_TABLE,
    },
    geometry: { type: 'vector', paths: [] },
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
  });
  const plan: Plan = {
    id: 'pz',
    jobId: job.id,
    createdAt: new Date().toISOString(),
    operations: [
      {
        operationId: 'op1',
        layerName: 'L',
        layerColor: '#fff',
        passIndex: 0,
        moves: [
          { type: 'setZ', z: 0 },
          { type: 'rapid', to: { x: 0, y: 0 } },
          { type: 'laserOff' },
        ],
      },
      {
        operationId: 'op1',
        layerName: 'L',
        layerColor: '#fff',
        passIndex: 1,
        moves: [
          { type: 'setZ', z: -1 },
          { type: 'rapid', to: { x: 0, y: 0 } },
          { type: 'laserOff' },
        ],
      },
    ],
    stats: {
      totalDistanceMm: 0,
      rapidDistanceMm: 0,
      cutDistanceMm: 0,
      estimatedTimeSeconds: 0,
      moveCount: 0,
      operationCount: 2,
      passCount: 2,
    },
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  const text = strategy!.generate(plan, job, { startMode: 'current', returnPosition: null }).text ?? '';
  assert(text.includes('G0 Z-1.000'), 'Head multi-pass: second pass Z is relative delta -1 from 0');
}

// ─── Head: custom header template gets trailing G91 override comment ───────
{
  const { job, plan } = rectangleJobAndPlan(false);
  const text = strategy!.generate(plan, job, {
    startMode: 'current',
    returnPosition: null,
    gcodeHeaderTemplate: '; user header\nM5 S0',
  }).text ?? '';
  assert(text.includes('G91 ; LaserForge: Head mode requires relative positioning'), 'Head + template: injected G91 hint after template');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
