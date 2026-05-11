/**
 * T1-160: regression test for the pure preset-ops helpers extracted
 * from MaterialPresets.
 *
 * Run: npx tsx tests/preset-ops-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveScoreFromCut,
  normalizePresetOps,
  type LaserOp,
} from '../src/core/materials/presetOpsHelpers';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-160 preset-ops helpers ===\n');

// -------- deriveScoreFromCut: typical preset --------
{
  const cut: LaserOp = { power: 100, speed: 500, passes: 2 };
  const score = deriveScoreFromCut(cut);
  // power: 20% of 100 = 20, in [1, 100]
  assert(score.power === 20, 'power: 20% of cut.power (100 → 20)');
  // speed: 4× 500 = 2000, clamped to [2000, 6000] (at min boundary)
  assert(score.speed === 2000, 'speed: 4× cut.speed (500 → 2000, at min boundary)');
  assert(score.passes === 1, 'passes: always 1');
}

// -------- deriveScoreFromCut: power clamps to [1, 100] --------
{
  // Cut with tiny power → 20% would be < 1 → clamped to 1
  const tinyCut: LaserOp = { power: 1, speed: 500, passes: 1 };
  const tinyScore = deriveScoreFromCut(tinyCut);
  // 20% of 1 = 0.2 → rounded to 0 → clamped to min 1
  assert(tinyScore.power === 1, 'power=1 input → score power clamped up to 1');

  // Power=500 (hypothetical) → 20% = 100 (at max)
  const bigCut: LaserOp = { power: 500, speed: 500, passes: 1 };
  const bigScore = deriveScoreFromCut(bigCut);
  // 20% of 500 = 100 → clamped to 100 max
  assert(bigScore.power === 100, 'power=500 → score power clamped to max 100');
}

// -------- deriveScoreFromCut: speed clamps to [2000, 6000] --------
{
  // Speed=100 → 4× = 400 → clamped UP to 2000
  const slow: LaserOp = { power: 50, speed: 100, passes: 1 };
  const slowScore = deriveScoreFromCut(slow);
  assert(slowScore.speed === 2000, 'speed=100 → score speed clamped UP to 2000');

  // Speed=2000 → 4× = 8000 → clamped DOWN to 6000
  const fast: LaserOp = { power: 50, speed: 2000, passes: 1 };
  const fastScore = deriveScoreFromCut(fast);
  assert(fastScore.speed === 6000, 'speed=2000 → score speed clamped DOWN to 6000');
}

// -------- deriveScoreFromCut: rounding --------
{
  // Power 7.5 → 20% = 1.5 → rounded to 2
  const cut: LaserOp = { power: 7.5, speed: 500, passes: 1 };
  const score = deriveScoreFromCut(cut);
  assert(score.power === 2, 'power 7.5 → 20% = 1.5 → rounds to 2');
}

// -------- normalizePresetOps: score present passthrough --------
{
  const explicitScore: LaserOp = { power: 30, speed: 3000, passes: 2 };
  const ops = normalizePresetOps({
    cut: { power: 100, speed: 500, passes: 1 },
    engrave: { power: 40, speed: 4000, passes: 1 },
    score: explicitScore,
  });
  assert(ops.score === explicitScore,
    'explicit score is preserved (same reference)');
}

// -------- normalizePresetOps: score missing → derived --------
{
  const ops = normalizePresetOps({
    cut: { power: 100, speed: 500, passes: 1 },
    engrave: { power: 40, speed: 4000, passes: 1 },
  });
  assert(ops.score != null, 'missing score → derived non-null');
  assert(ops.score!.power === 20,
    'derived score power = deriveScoreFromCut(cut).power');
}

// -------- normalizePresetOps: cut + engrave passed through --------
{
  const cut: LaserOp = { power: 75, speed: 700, passes: 3 };
  const engrave: LaserOp = { power: 35, speed: 5000, passes: 1 };
  const ops = normalizePresetOps({ cut, engrave });
  assert(ops.cut === cut, 'cut reference passed through');
  assert(ops.engrave === engrave, 'engrave reference passed through');
}

// -------- normalizePresetOps doesn't mutate input --------
{
  const input = {
    cut: { power: 50, speed: 1000, passes: 1 },
    engrave: { power: 20, speed: 3000, passes: 1 },
  };
  const cutBefore = input.cut;
  normalizePresetOps(input);
  assert(input.cut === cutBefore, 'input.cut reference unchanged');
  assert(!('score' in input), 'input not mutated to add score');
}

// -------- Source-level pin: MaterialPresets delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const mpSrc = readFileSync(
    resolve(here, '../src/core/materials/MaterialPresets.ts'),
    'utf-8',
  );
  assert(/from '\.\/presetOpsHelpers'/.test(mpSrc),
    'MaterialPresets imports from ./presetOpsHelpers');
  assert(/T1-160/.test(mpSrc),
    'MaterialPresets carries T1-160 marker');
  assert(!/^interface LaserOp \{$/m.test(mpSrc),
    'inline LaserOp interface is gone from MaterialPresets');
  assert(!/^function deriveScoreFromCut/m.test(mpSrc),
    'inline deriveScoreFromCut is gone');
  assert(!/^function normalizePresetOps/m.test(mpSrc),
    'inline normalizePresetOps is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/core/materials/presetOpsHelpers.ts'),
    'utf-8',
  );
  assert(/T1-160/.test(helperSrc),
    'presetOpsHelpers carries T1-160 marker');
  assert(/export function deriveScoreFromCut/.test(helperSrc),
    'deriveScoreFromCut is exported');
  assert(/export function normalizePresetOps/.test(helperSrc),
    'normalizePresetOps is exported');
  assert(/export interface LaserOp/.test(helperSrc),
    'LaserOp is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
