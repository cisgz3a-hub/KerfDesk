/**
 * T3-22: grayscale raster should merge near-identical adjacent power values.
 * Run: npx tsx tests/raster-grayscale-merge-tolerance.test.ts
 */
import { readFileSync } from 'node:fs';
import type { ProcessedBitmap } from '../src/core/job/Job';
import {
  DEFAULT_GRAYSCALE_POWER_MERGE_TOLERANCE,
  generateRasterScanlines,
  type RasterSettings,
} from '../src/core/plan/RasterGenerator';
import { defaultLaserSettings } from '../src/core/scene/Layer';

const EXPECTED_DEFAULT_GRAYSCALE_POWER_MERGE_TOLERANCE = 2;

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.error('expected', expected);
    console.error('actual', actual);
  }
  assert(ok, msg);
}

function assertIncludes(haystack: string, needle: string, msg: string): void {
  assert(haystack.includes(needle), `${msg} (${needle})`);
}

const baseSettings: RasterSettings = {
  powerMin: 0,
  powerMax: 100,
  speed: 1000,
  biDirectional: false,
  overscanning: 0,
};

function makeBitmap(data: number[]): ProcessedBitmap {
  return {
    width: data.length,
    height: 1,
    dpi: 254,
    sourceObjectId: 'gray-merge',
    mode: 'grayscale',
    data: new Uint8Array(data),
    physicalWidth: data.length,
    physicalHeight: 1,
    position: { x: 0, y: 0 },
    pipeline: {
      brightness: 0,
      contrast: 0,
      gamma: 1,
      ditheringMode: 'none',
      inverted: false,
      imageMode: 'grayscale',
    },
  };
}

function segmentPowers(data: number[], settings: Partial<RasterSettings> = {}): number[] {
  const lines = generateRasterScanlines(makeBitmap(data), { ...baseSettings, ...settings });
  return lines.flatMap(line => line.segments.map(seg => seg.power));
}

function segmentWidths(data: number[], settings: Partial<RasterSettings> = {}): number[] {
  const lines = generateRasterScanlines(makeBitmap(data), { ...baseSettings, ...settings });
  return lines.flatMap(line => line.segments.map(seg => seg.endX - seg.startX));
}

console.log('\n=== raster grayscale merge tolerance ===\n');

{
  assert(
    DEFAULT_GRAYSCALE_POWER_MERGE_TOLERANCE === EXPECTED_DEFAULT_GRAYSCALE_POWER_MERGE_TOLERANCE,
    'default grayscale power merge tolerance is 2 power points',
  );
  const settings = defaultLaserSettings('image');
  assert(
    settings.image.grayscalePowerMergeTolerance === EXPECTED_DEFAULT_GRAYSCALE_POWER_MERGE_TOLERANCE,
    'new image layers default grayscale merge tolerance',
  );
}

{
  // Luminance [0, 3, 5, 20] maps to powers [100, 99, 98, 92].
  // Default tolerance 2 should merge the first three pixels, then split at 92.
  assertEq(segmentPowers([0, 3, 5, 20]), [100, 92], 'default tolerance merges near-identical powers');
  assertEq(segmentWidths([0, 3, 5, 20]), [3, 1], 'merged segment spans all near-identical pixels');
}

{
  assertEq(
    segmentPowers([0, 3, 5, 20], { grayscalePowerMergeTolerance: 0 }),
    [100, 99, 98, 92],
    'zero tolerance preserves exact-power segmentation',
  );
  assertEq(
    segmentPowers([0, 3, 5, 20], { grayscalePowerMergeTolerance: 10 }),
    [100],
    'larger tolerance intentionally merges broader grayscale ramps',
  );
}

{
  assertEq(
    segmentPowers([0, 3, 255, 5], { grayscalePowerMergeTolerance: 10 }),
    [100, 98],
    'off pixels still split runs even when tolerance is high',
  );
}

{
  const layerSource = readFileSync('src/core/scene/Layer.ts', 'utf8');
  const jobSource = readFileSync('src/core/job/Job.ts', 'utf8');
  const compilerSource = readFileSync('src/core/job/JobCompiler.ts', 'utf8');
  const optimizerSource = readFileSync('src/core/plan/PlanOptimizer.ts', 'utf8');
  const propertiesSource = readFileSync('src/ui/components/PropertiesPanel.tsx', 'utf8');

  assertIncludes(layerSource, 'grayscalePowerMergeTolerance', 'layer image settings persist the tolerance');
  assertIncludes(jobSource, 'grayscalePowerMergeTolerance', 'resolved job settings carry the tolerance');
  assertIncludes(compilerSource, 'grayscalePowerMergeTolerance', 'job compiler resolves the tolerance');
  assertIncludes(optimizerSource, 'grayscalePowerMergeTolerance', 'plan optimizer passes tolerance into raster generation');
  assertIncludes(propertiesSource, 'Power merge tolerance', 'image properties UI exposes the tolerance');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
