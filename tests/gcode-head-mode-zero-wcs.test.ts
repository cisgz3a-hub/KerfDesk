/**
 * Head-mode (startMode='current') must emit G10 L20 P1 X0 Y0 at the top of
 * the gcode header so the GRBL work coordinate system is zeroed at the
 * laser head's current physical position. Without this, Head-mode coords
 * — which are relative to the design's (0,0) corner — land at machine
 * origin (bed corner) instead of wherever the user jogged.
 *
 * Bed mode (absolute) and savedOrigin mode must NOT emit this line. They
 * rely on WCS already being aligned with machine origin by the
 * post-connect handshake (G10 L2 P1 X0 Y0 Z0 in GrblController).
 *
 * Run: npx tsx tests/gcode-head-mode-zero-wcs.test.ts
 */

import { type Plan } from '../src/core/plan/Plan';
import { createEmptyJob, type Job } from '../src/core/job/Job';
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

console.log('\n=== gcode-head-mode-zero-wcs ===');

const strategy = getOutputStrategy('grbl');
assert(!!strategy, 'GRBL strategy registered');

function makeJobAndPlan(): { job: Job; plan: Plan } {
  const job: Job = createEmptyJob('wcs', 'tproj');
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
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  });
  const plan: Plan = {
    id: 'p1',
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
  return { job, plan };
}

const ZERO_WCS_RE = /^G10\s+L20\s+P1\s+X0\s+Y0\b/;

// ─── TEST 1: Head mode emits G10 L20 exactly once, before first move ─────
{
  const { job, plan } = makeJobAndPlan();
  const out = strategy!.generate(plan, job, { startMode: 'current' });
  const text = out.text ?? '';
  const lines = text.split('\n');

  const zeroIdx = lines.findIndex(l => ZERO_WCS_RE.test(l.trim()));
  const firstG = lines.findIndex(l => /^(G0|G1)\b/.test(l.trim()));
  const matchCount = lines.filter(l => ZERO_WCS_RE.test(l.trim())).length;

  assert(zeroIdx >= 0, 'head mode: G10 L20 P1 X0 Y0 present');
  assert(matchCount === 1, 'head mode: G10 L20 appears exactly once');
  assert(firstG > zeroIdx, 'head mode: G10 L20 precedes first motion line');

  const g90Idx = lines.findIndex(l => /^G90\b/.test(l.trim()));
  const g21Idx = lines.findIndex(l => /^G21\b/.test(l.trim()));
  assert(
    g90Idx >= 0 && g21Idx >= 0 && zeroIdx > Math.max(g90Idx, g21Idx),
    'head mode: G10 L20 appears after G90/G21 base header',
  );
}

// ─── TEST 2: Bed (absolute) mode does NOT emit G10 L20 ──────────────────
{
  const { job, plan } = makeJobAndPlan();
  const out = strategy!.generate(plan, job, { startMode: 'absolute' });
  const text = out.text ?? '';
  assert(!/G10\s+L20/.test(text), 'absolute mode: no G10 L20 in output');
}

// ─── TEST 3: savedOrigin mode does NOT emit G10 L20 ─────────────────────
{
  const { job, plan } = makeJobAndPlan();
  const out = strategy!.generate(plan, job, {
    startMode: 'savedOrigin',
    savedOrigin: { x: 50, y: 50 },
  });
  const text = out.text ?? '';
  assert(!/G10\s+L20/.test(text), 'savedOrigin mode: no G10 L20 in output');
}

// ─── TEST 4: Head mode with customStartGcode — G10 L20 precedes it ──────
{
  const { job, plan } = makeJobAndPlan();
  const out = strategy!.generate(plan, job, {
    startMode: 'current',
    customStartGcode: 'M7 ; air on',
  });
  const text = out.text ?? '';
  const lines = text.split('\n');
  const zeroIdx = lines.findIndex(l => ZERO_WCS_RE.test(l.trim()));
  const customIdx = lines.findIndex(l => /^M7\b/.test(l.trim()));
  assert(zeroIdx >= 0, 'head mode + custom start: G10 L20 still present');
  assert(customIdx >= 0, 'head mode + custom start: custom M7 present');
  assert(zeroIdx < customIdx, 'head mode: G10 L20 precedes custom start gcode');
}

// ─── TEST 5: Default (no startMode) does NOT inject G10 L20 ─────────────
// Keeps old callers (e.g. ad-hoc tests omitting startMode) byte-stable.
{
  const { job, plan } = makeJobAndPlan();
  const out = strategy!.generate(plan, job, {});
  const text = out.text ?? '';
  assert(!/G10\s+L20/.test(text), 'missing startMode: no G10 L20 (backward compatible)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
