/**
 * Raster safety regression: rapid moves must be hard-off at the emitted
 * G-code layer, not merely assumed safe because GRBL laser mode may turn
 * G0 off when $32=1.
 *
 * Real failure this protects:
 *   - Large raster/image engraving leaves M4 modal across scanlines.
 *   - A later G0 travels to the next row.
 *   - If the controller is not truly in laser mode, or the profile/settings
 *     detection is wrong, that G0 can burn an unintended line.
 *
 * Run: npx tsx tests/raster-rapid-hard-off-safety.test.ts
 */
import assert from 'node:assert/strict';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import type { Job } from '../src/core/job/Job';
import type { Plan } from '../src/core/plan/Plan';

const job = {
  id: 'job-raster-rapid-hard-off',
  name: 'raster rapid hard off',
  createdAt: '2026-05-22T00:00:00.000Z',
  operations: [{
    id: 'op-raster',
    settings: { passes: 1 },
  }],
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 1 },
  metadata: {
    objectCount: 1,
    layerCount: 1,
    sourceProjectId: 'test',
  },
} as unknown as Job;

const plan = {
  id: 'plan-raster-rapid-hard-off',
  jobId: job.id,
  createdAt: '2026-05-22T00:00:00.000Z',
  operations: [{
    operationId: 'op-raster',
    layerName: 'Raster',
    layerColor: '#000000',
    passIndex: 0,
    moves: [
      { type: 'laserOn', power: 0 },
      { type: 'rapid', to: { x: 0, y: 0 } },
      { type: 'linear', to: { x: 10, y: 0 }, power: 80, speed: 1200 },
      { type: 'rapid', to: { x: 0, y: 1 } },
      { type: 'linear', to: { x: 10, y: 1 }, power: 80, speed: 1200 },
      { type: 'laserOff' },
    ],
  }],
  stats: {
    totalDistanceMm: 0,
    rapidDistanceMm: 0,
    cutDistanceMm: 0,
    estimatedTimeSeconds: 0,
    moveCount: 6,
    operationCount: 1,
    passCount: 1,
  },
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 1 },
} as unknown as Plan;

function executableLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim())
    .filter(Boolean);
}

function isRapidXy(line: string): boolean {
  return /^G0\b/i.test(line) && /\b[XY]/i.test(line);
}

const strategy = new GrblOutputStrategy();
const output = strategy.generate(plan, job, {
  maxSpindle: 1000,
  grblLaserPowerMode: 'dynamic-m4',
  clock: () => '2026-05-22T00:00:00.000Z',
});
assert(output.text, 'strategy generates G-code text');

const lines = executableLines(output.text);
const rapidIndices = lines
  .map((line, index) => isRapidXy(line) ? index : -1)
  .filter(index => index >= 0);

assert(rapidIndices.length >= 2, 'fixture emits raster scanline rapid moves');

for (const index of rapidIndices) {
  assert.match(
    lines[index - 1] ?? '',
    /^M5\b.*\bS0\b/i,
    `rapid "${lines[index]}" is preceded by a hard laser-off command`,
  );
  assert.match(
    lines[index + 1] ?? '',
    /^M4\b.*\bS0\b/i,
    `rapid "${lines[index]}" is followed by M4 S0 re-arm before later burn moves`,
  );
}

console.log('\n=== raster rapid hard-off safety ===');
console.log('PASS emitted raster rapids are bracketed by M5 S0 and M4 S0');
