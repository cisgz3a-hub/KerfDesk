/**
 * Head mode + gcodeFooterTemplate: inject relative return before template (Falcon default).
 *
 * Run: npx tsx tests/gcode-relative-return-template.test.ts
 */

import { createEmptyJob, type Job } from '../src/core/job/Job';
import { type Plan } from '../src/core/plan/Plan';
import { getOutputStrategy } from '../src/core/output/Output';
import '../src/core/output/GrblStrategy';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';
import { emptyTemplateContext } from '../src/core/plan/GcodeTemplates';

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

const FOOTER_TEMPLATE = [
  'M5 ; laser off',
  'G0 X{RETURN_X} Y{RETURN_Y} ; return to origin',
  'M2 ; program end',
].join('\n');

function jobRect38OpenTop(): { job: Job; plan: Plan } {
  const job: Job = createEmptyJob('tpl-ret', 't');
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
      speed: 1500,
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
    bounds: { minX: 0, minY: 0, maxX: 38, maxY: 38 },
  });
  const plan: Plan = {
    id: 'p38',
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
          { type: 'laserOn', power: 15 },
          { type: 'linear', to: { x: 38, y: 0 }, power: 15, speed: 1500 },
          { type: 'linear', to: { x: 38, y: 38 }, power: 15, speed: 1500 },
          { type: 'linear', to: { x: 0, y: 38 }, power: 15, speed: 1500 },
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
    bounds: { minX: 0, minY: 0, maxX: 38, maxY: 38 },
  };
  return { job, plan };
}

console.log('\n=== gcode-relative-return-template ===');

const strategy = getOutputStrategy('grbl');
assert(!!strategy, 'GRBL strategy registered');

// ─── 1) Head + template: injected return before template return ───────────
{
  const { job, plan } = jobRect38OpenTop();
  const ctx = { ...emptyTemplateContext(), jobName: job.name || 't', returnX: 0, returnY: 0 };
  const text = strategy!.generate(plan, job, {
    startMode: 'current',
    gcodeFooterTemplate: FOOTER_TEMPLATE,
    gcodeTemplateContext: ctx,
  }).text ?? '';

  const idxInject = text.indexOf('return to start');
  const idxTpl = text.indexOf('return to origin');
  assert(idxInject >= 0 && idxTpl > idxInject, 'Head+template: return to start precedes template return to origin');
  assert(
    /G0 X-0\.000 Y-38\.000 ; return to start/.test(text) || /G0 X0\.000 Y-38\.000 ; return to start/.test(text),
    'Head+template: negated final Y (-38) for open path ending at (0,38)',
  );
  assert(text.includes('G0 X0.000 Y0.000 ; return to origin'), 'Head+template: template still emits WCS return line');
  assert(text.includes('G90 ; restore absolute positioning'), 'Head+template: G90 restore after template');
}

// ─── 2) Bed + template: no injected relative return; template XY from context ───
{
  const { job, plan } = jobRect38OpenTop();
  const ctx = {
    ...emptyTemplateContext(),
    jobName: job.name || 't',
    returnX: 33,
    returnY: 44,
  };
  const text = strategy!.generate(plan, job, {
    startMode: 'absolute',
    gcodeFooterTemplate: FOOTER_TEMPLATE,
    gcodeTemplateContext: ctx,
  }).text ?? '';

  assert(!text.includes('; return to start'), 'Bed+template: no relative return injection');
  assert(text.includes('G0 X33.000 Y44.000 ; return to origin'), 'Bed+template: footer uses context return X/Y');
}

// ─── 3) Head + template + degenerate XY (stay at 0,0): no injection ────────
{
  const job: Job = createEmptyJob('deg', 't');
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
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  });
  const plan: Plan = {
    id: 'pdeg',
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
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  const ctx = { ...emptyTemplateContext(), jobName: 'deg', returnX: 0, returnY: 0 };
  const text = strategy!.generate(plan, job, {
    startMode: 'current',
    gcodeFooterTemplate: FOOTER_TEMPLATE,
    gcodeTemplateContext: ctx,
  }).text ?? '';

  assert(!text.includes('; return to start'), 'Degenerate Head path: suppress return to start when _prevPos ~ (0,0)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
