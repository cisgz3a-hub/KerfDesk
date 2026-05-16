/**
 * T1-188 (external audit High #2 + #8 wiring): compile-time
 * consistency check between the plan-derived burn envelope and the
 * emitted-gcode burn envelope.
 *
 * T1-182 shipped the parser. T1-188 ships the consumer:
 * `checkBurnEnvelopeDivergence(plan, gcode)` returns null when they
 * agree within tolerance, or a structured `BurnEnvelopeDivergenceReport`
 * when they disagree. The audit's framing was "the user may approve
 * a preview that is not the actual program" — this check catches
 * encoder bugs (pre-T1-173 raster overscan, pre-T1-180 zero-distance
 * dwell-burn) BEFORE the ticket is presented for approval.
 *
 * Run: npx tsx tests/burn-envelope-divergence.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkBurnEnvelopeDivergence,
  checkBurnEnvelopeDivergenceFromEnvelope,
  computePlanBurnEnvelope,
  BURN_ENVELOPE_DIVERGENCE_TOLERANCE_MM,
} from '../src/core/output/burnEnvelopeDivergence';
import type { Plan } from '../src/core/plan/Plan';

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

function makePlan(moves: Plan['operations'][number]['moves']): Plan {
  return {
    id: 'p1',
    jobId: 'j1',
    createdAt: '2026-05-12T00:00:00Z',
    operations: [{ operationId: 'op-1', layerName: 'L', layerColor: '#000', passIndex: 0, moves }],
    stats: {
      totalDistanceMm: 0, rapidDistanceMm: 0, cutDistanceMm: 0,
      estimatedTimeSeconds: 0, moveCount: moves.length, operationCount: 1, passCount: 1,
    },
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

console.log('\n=== T1-188 burn-envelope divergence check ===\n');

// -------- 1. computePlanBurnEnvelope: simple linear burn --------
{
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 10 } },
    { type: 'laserOn', power: 50 },
    { type: 'linear', to: { x: 50, y: 10 }, power: 50, speed: 1200 },
    { type: 'linear', to: { x: 50, y: 30 }, power: 50, speed: 1200 },
    { type: 'laserOff' },
  ]);
  const env = computePlanBurnEnvelope(plan);
  assert(env.burnBounds !== null, 'plan burn envelope: not null');
  if (env.burnBounds) {
    assert(env.burnBounds.minX === 10 && env.burnBounds.maxX === 50, 'plan AABB X = [10, 50]');
    assert(env.burnBounds.minY === 10 && env.burnBounds.maxY === 30, 'plan AABB Y = [10, 30]');
  }
  assert(env.burnMoveCount === 2, `plan burn move count === 2 (got ${env.burnMoveCount})`);
}

// -------- 2. computePlanBurnEnvelope: zero-power linear NOT counted --------
{
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 10 } },
    { type: 'linear', to: { x: 50, y: 10 }, power: 0, speed: 1200 },   // S0 gap-bridge — NOT a burn
    { type: 'linear', to: { x: 60, y: 10 }, power: 80, speed: 1200 },   // burn
  ]);
  const env = computePlanBurnEnvelope(plan);
  assert(env.burnMoveCount === 1, 'zero-power linear not counted as burn');
  if (env.burnBounds) {
    assert(env.burnBounds.minX === 50, `burn-only AABB starts at 50 (got ${env.burnBounds.minX})`);
    assert(env.burnBounds.maxX === 60, 'burn-only AABB ends at 60');
  }
}

// -------- 3. checkBurnEnvelopeDivergence: matching plan + gcode → null --------
{
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 10 } },
    { type: 'linear', to: { x: 50, y: 10 }, power: 50, speed: 1200 },
  ]);
  // Emitted gcode that exactly matches the plan: burn from (10,10) → (50,10).
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y10',
    'M4 S500',
    'G1 X50 Y10 F1200 S500',
    'M5 S0', 'M2',
  ].join('\n');
  const report = checkBurnEnvelopeDivergence(plan, gcode);
  assert(report === null, 'matching plan + gcode: no divergence');
}

// -------- 4. Plan has burns, gcode emits none → divergence detected --------
{
  const plan = makePlan([
    { type: 'linear', to: { x: 50, y: 10 }, power: 50, speed: 1200 },
  ]);
  const gcode = 'G21\nG90\nM5 S0\nG0 X50 Y10\nM2'; // no burn moves at all
  const report = checkBurnEnvelopeDivergence(plan, gcode);
  assert(report !== null, 'plan-has-burn / gcode-empty: divergence detected');
  if (report) {
    assert(report.kind === 'emitted-empty-plan-non-empty', `kind === 'emitted-empty-plan-non-empty' (got '${report.kind}')`);
    assert(report.planBurnMoveCount === 1, 'planBurnMoveCount === 1');
    assert(report.emittedBurnMoveCount === 0, 'emittedBurnMoveCount === 0');
    assert(report.maxEdgeDeltaMm === Infinity, 'maxEdgeDeltaMm === Infinity for empty/non-empty mismatch');
  }
}

// -------- 5. Gcode has burns, plan has none → divergence detected --------
{
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 10 } },
    { type: 'linear', to: { x: 50, y: 10 }, power: 0, speed: 1200 },   // zero-power "linear"
  ]);
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y10',
    'M4 S500',
    'G1 X50 Y10 F1200',  // burn at S=500
    'M5 S0',
  ].join('\n');
  const report = checkBurnEnvelopeDivergence(plan, gcode);
  assert(report !== null, 'plan-empty / gcode-has-burn: divergence detected');
  if (report) {
    assert(report.kind === 'plan-empty-emitted-non-empty', `kind matches`);
  }
}

// -------- 6. Both non-empty but edges disagree → 'envelope-edge-mismatch' --------
{
  // Simulate the pre-T1-173 raster overscan bug: gcode bounds extend
  // 3mm beyond the plan bounds on both X sides.
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 0 } },
    { type: 'linear', to: { x: 20, y: 0 }, power: 80, speed: 1200 },
  ]);
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X7 Y0',                          // rapid to overscan-from (1990s-style raster bug)
    'M4 S800',
    'G1 X23 Y0 F1200',                  // BURN beyond plan (10..20 → 7..23)
    'M5 S0',
  ].join('\n');
  const report = checkBurnEnvelopeDivergence(plan, gcode);
  assert(report !== null, 'envelope-edge-mismatch: divergence detected');
  if (report) {
    assert(report.kind === 'envelope-edge-mismatch', `kind === 'envelope-edge-mismatch' (got '${report.kind}')`);
    assert(report.maxEdgeDeltaMm >= 3, `maxEdgeDeltaMm captures the 3mm overscan (got ${report.maxEdgeDeltaMm})`);
    assert(report.toleranceMm === BURN_ENVELOPE_DIVERGENCE_TOLERANCE_MM, 'tolerance preserved in report');
  }
}

// -------- 7. Within-tolerance noise: NO divergence --------
{
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 0 } },
    { type: 'linear', to: { x: 20, y: 0 }, power: 80, speed: 1200 },
  ]);
  // Gcode endpoint shifted by 0.1mm — within tolerance (0.5mm).
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X10 Y0',
    'M4 S800',
    'G1 X20.1 Y0 F1200',
    'M5 S0',
  ].join('\n');
  const report = checkBurnEnvelopeDivergence(plan, gcode);
  assert(report === null, 'sub-tolerance noise: no divergence');
}

// -------- 8. Both plans empty → no divergence --------
{
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 10 } },
    // No burns.
  ]);
  const gcode = 'G21\nG90\nG0 X10 Y10\nM2';
  const report = checkBurnEnvelopeDivergence(plan, gcode);
  assert(report === null, 'both empty: no divergence');
}

// -------- 9. Source pins on the implementation --------
{
  const plan = makePlan([
    { type: 'rapid', to: { x: 10, y: 10 } },
    { type: 'linear', to: { x: 50, y: 10 }, power: 50, speed: 1200 },
  ]);
  const report = checkBurnEnvelopeDivergenceFromEnvelope(plan, {
    burnBounds: { minX: 7, minY: 10, maxX: 53, maxY: 10 },
    burnMoveCount: 1,
    zeroDistanceLinearCount: 0,
  });
  assert(report !== null, 'precomputed emitted envelope can be checked for divergence');
  if (report) {
    assert(report.kind === 'envelope-edge-mismatch', 'precomputed envelope mismatch reports edge divergence');
    assert(report.maxEdgeDeltaMm === 3, `precomputed maxEdgeDeltaMm === 3 (got ${report.maxEdgeDeltaMm})`);
  }
}

// -------- 10. Source pins on the implementation --------
{
  const src = readFileSync(resolve(here, '../src/core/output/burnEnvelopeDivergence.ts'), 'utf-8');
  assert(/T1-188/.test(src), 'burnEnvelopeDivergence.ts carries T1-188 marker');
  assert(/audit High #2 \+ #8/.test(src), 'cross-references audit High #2 + #8');
  assert(
    /export function checkBurnEnvelopeDivergence/.test(src),
    'checkBurnEnvelopeDivergence exported',
  );
  assert(
    /export function computePlanBurnEnvelope/.test(src),
    'computePlanBurnEnvelope exported',
  );
  assert(
    /export function checkBurnEnvelopeDivergenceFromEnvelope/.test(src),
    'checkBurnEnvelopeDivergenceFromEnvelope exported',
  );
  assert(
    /BURN_ENVELOPE_DIVERGENCE_TOLERANCE_MM = 0\.5/.test(src),
    'tolerance constant is 0.5 mm',
  );

  const pipelineSrc = readFileSync(resolve(here, '../src/app/PipelineService.ts'), 'utf-8');
  assert(/T1-188/.test(pipelineSrc), 'PipelineService.ts carries T1-188 marker');
  assert(
    /const burnEnvelopeDivergence =/.test(pipelineSrc) && /burnEnvelopeDivergence,/.test(pipelineSrc),
    'PipelineService.ts computes and populates burnEnvelopeDivergence field',
  );
  assert(
    /checkBurnEnvelopeDivergenceFromEnvelope\(machineTransform\.plan, emittedBurnEnvelope\)/.test(pipelineSrc),
    'PipelineService.ts checks divergence from the stream-derived emitted envelope',
  );

  const ticketSrc = readFileSync(resolve(here, '../src/core/job/ValidatedJobTicket.ts'), 'utf-8');
  assert(
    /burnEnvelopeDivergence:\s*BurnEnvelopeDivergenceReport\s*\|\s*null/.test(ticketSrc),
    'ValidatedJobTicket declares burnEnvelopeDivergence field',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
