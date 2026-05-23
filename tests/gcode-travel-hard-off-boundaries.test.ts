/**
 * Regression for real-machine raster connector burns: generated GRBL output
 * must not leave modal M3/M4 armed across blank travel, row-to-row rapids, or
 * vector/path jumps. Travel stays hard-off; positive burn moves re-arm
 * immediately before the burn.
 *
 * Run: npx tsx tests/gcode-travel-hard-off-boundaries.test.ts
 */
import assert from 'node:assert/strict';
import { createEmptyJob } from '../src/core/job/Job';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';

type ModalViolation = { lineNumber: number; line: string; reason: string };

function executable(line: string): string {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
}

function words(line: string): Array<{ letter: string; value: number }> {
  const out: Array<{ letter: string; value: number }> = [];
  const re = /([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    out.push({ letter: match[1].toUpperCase(), value: Number(match[2]) });
  }
  return out;
}

function findTravelWhileLaserArmed(gcode: string): ModalViolation[] {
  let laserArmed = false;
  let modalS = 0;
  const violations: ModalViolation[] = [];
  const lines = gcode.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const code = executable(raw);
    if (!code) continue;

    const parsedWords = words(code);
    let lineMotion: 'G0' | 'G1' | null = null;
    let lineS: number | null = null;

    for (const word of parsedWords) {
      if (word.letter === 'M') {
        if (word.value === 3 || word.value === 4) laserArmed = true;
        if (word.value === 5) {
          laserArmed = false;
          modalS = 0;
        }
      } else if (word.letter === 'G') {
        if (word.value === 0) lineMotion = 'G0';
        if (word.value === 1) lineMotion = 'G1';
      } else if (word.letter === 'S') {
        lineS = word.value;
      }
    }

    const hasXyMotion = lineMotion != null && parsedWords.some(word => word.letter === 'X' || word.letter === 'Y');
    if (hasXyMotion) {
      const effectiveS = lineS ?? modalS;
      const positiveBurn = lineMotion === 'G1' && effectiveS > 0;
      if (!positiveBurn && laserArmed) {
        violations.push({
          lineNumber: index + 1,
          line: raw,
          reason: `${lineMotion} travel emitted while modal laser is armed`,
        });
      }
      if (positiveBurn && !laserArmed) {
        violations.push({
          lineNumber: index + 1,
          line: raw,
          reason: 'positive-power burn emitted without an immediate M3/M4 re-arm',
        });
      }
    }

    if (lineS != null) modalS = lineS;
  }

  return violations;
}

function makeJobAndPlan() {
  const job = createEmptyJob('hard-off-boundaries', 'test-project');
  job.operations = [{
    id: 'op-hard-off-boundaries',
    layerId: 'layer-hard-off-boundaries',
    layerName: 'Raster',
    layerColor: '#000000',
    order: 0,
    type: 'raster',
    settings: {
      powerMin: 0,
      powerMax: 80,
      speed: 1200,
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
      minPowerRatioAccel: 0.2,
      scanningOffsets: [],
    },
    geometry: { type: 'raster', bitmap: null },
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 2 },
  } as any];
  job.metadata.objectCount = 1;
  job.metadata.layerCount = 1;

  const plan = createEmptyPlan(job.id);
  plan.operations = [{
    operationId: 'op-hard-off-boundaries',
    layerName: 'Raster',
    layerColor: '#000000',
    passIndex: 0,
    moves: [
      { type: 'laserOn', power: 0 },
      { type: 'rapid', to: { x: 0, y: 0 } },
      { type: 'linear', to: { x: 10, y: 0 }, power: 80, speed: 1200 },
      { type: 'linear', to: { x: 50, y: 0 }, power: 0, speed: 1200 },
      { type: 'rapid', to: { x: 0, y: 1 } },
      { type: 'linear', to: { x: 5, y: 1 }, power: 0, speed: 1200 },
      { type: 'linear', to: { x: 15, y: 1 }, power: 80, speed: 1200 },
      { type: 'laserOff' },
    ],
  }];
  plan.bounds = { minX: 0, minY: 0, maxX: 60, maxY: 2 };
  plan.stats = {
    totalDistanceMm: 0,
    rapidDistanceMm: 0,
    cutDistanceMm: 0,
    estimatedTimeSeconds: 0,
    moveCount: plan.operations[0].moves.length,
    operationCount: 1,
    passCount: 1,
  };

  return { job, plan };
}

const { job, plan } = makeJobAndPlan();
const output = new GrblOutputStrategy().generate(plan, job, {
  clock: () => '2026-05-23T00:00:00.000Z',
  maxSpindle: 1000,
});
const text = output.text ?? '';
const violations = findTravelWhileLaserArmed(text);

assert.deepEqual(violations, [], `travel/burn modal violations:\n${JSON.stringify(violations, null, 2)}`);
assert.match(text, /M5 S0\nG1 X50\.000 Y0\.000(?: F1200)?\nM5 S0\nG0 X0\.000 Y1\.000/m,
  'zero-power travel remains hard-off; following rapid also starts from hard-off');
assert.match(text, /M5 S0\nG1 X5\.000 Y1\.000(?: F1200)?\nM4 S0\nG1 X15\.000 Y1\.000 S800/m,
  'positive burn re-arms immediately before the burn, not before blank travel');

console.log('\n=== G-code travel hard-off boundaries ===');
console.log('PASS generated travel moves stay hard-off until the next positive burn');
