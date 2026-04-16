/**
 * Image preprocessing and grayscale raster behavior.
 * Run: npx tsx tests/image-processing.test.ts
 */

import type { ProcessedBitmap } from '../src/core/job/Job';
import {
  adjustBrightness,
  adjustContrast,
  invertImage,
  thresholdToOneBit,
} from '../src/core/image/ImageProcessing';
import { generateRasterScanlines, luminanceToLaserPower, type RasterSettings } from '../src/core/plan/RasterGenerator';

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

const rasterSettings: RasterSettings = {
  powerMin: 0,
  powerMax: 100,
  speed: 1000,
  biDirectional: false,
  overscanning: 0,
};

console.log('\n=== adjustBrightness ===');
{
  const base = new Uint8Array([128]);
  const up = adjustBrightness(base, 50);
  const down = adjustBrightness(base, -50);
  assert(up[0] > 128, 'adjustBrightness(+50) increases mid pixel');
  assert(down[0] < 128, 'adjustBrightness(-50) decreases mid pixel');
  assert(base[0] === 128, 'adjustBrightness does not mutate source');
}

console.log('\n=== adjustContrast ===');
{
  const ramp = new Uint8Array([100, 150]);
  const out = adjustContrast(ramp, 100);
  const spreadBefore = ramp[1] - ramp[0];
  const spreadAfter = out[1] - out[0];
  assert(spreadAfter > spreadBefore, 'adjustContrast(+100) increases tonal range');
}

console.log('\n=== invertImage ===');
{
  const a = new Uint8Array([0, 128, 255]);
  const b = invertImage(a);
  assert(b[0] === 255 && b[1] === 127 && b[2] === 0, 'invertImage flips values');
  assert(a[0] === 0, 'invertImage does not mutate source');
}

console.log('\n=== luminanceToLaserPower ===');
{
  assert(luminanceToLaserPower(0, 0, 100) === 100, 'black → powerMax');
  assert(luminanceToLaserPower(255, 0, 100) === 0, 'white → 0 when powerMin 0');
  const mid = luminanceToLaserPower(128, 10, 100);
  assert(mid > 10 && mid < 100, 'mid gray maps between min and max');
}

console.log('\n=== grayscale raster variable S ===');
{
  const data = new Uint8Array([0, 64, 128, 192, 255]);
  const bitmap: ProcessedBitmap = {
    width: 5,
    height: 1,
    dpi: 254,
    mode: 'grayscale',
    data,
    physicalWidth: 5,
    physicalHeight: 1,
    position: { x: 0, y: 0 },
    pipeline: { brightness: 0, contrast: 0, gamma: 1, ditheringMode: 'none', inverted: false, imageMode: 'grayscale' },
  };
  const lines = generateRasterScanlines(bitmap, { ...rasterSettings, powerMin: 10, powerMax: 100 });
  assert(lines.length === 1, 'one scanline');
  const powers = lines[0].segments.map(s => s.power);
  const uniq = new Set(powers);
  assert(uniq.size >= 3, 'grayscale output uses multiple distinct S values (not only binary)');
}

console.log('\n=== grayscale merge same S ===');
{
  const data = new Uint8Array([80, 80, 80, 200]);
  const bitmap: ProcessedBitmap = {
    width: 4,
    height: 1,
    dpi: 254,
    mode: 'grayscale',
    data,
    physicalWidth: 4,
    physicalHeight: 1,
    position: { x: 0, y: 0 },
    pipeline: { brightness: 0, contrast: 0, gamma: 1, ditheringMode: 'none', inverted: false, imageMode: 'grayscale' },
  };
  const lines = generateRasterScanlines(bitmap, rasterSettings);
  assert(lines.length === 1 && lines[0].segments.length === 2, 'adjacent same-luminance pixels merge into one G1 span per run');
}

console.log('\n=== threshold 1-bit raster ===');
{
  const gray = new Uint8Array([0, 100, 200, 255]);
  const one = thresholdToOneBit(gray, 4, 1, 128);
  const bitmap: ProcessedBitmap = {
    width: 4,
    height: 1,
    dpi: 254,
    mode: '1bit',
    data: one,
    physicalWidth: 4,
    physicalHeight: 1,
    position: { x: 0, y: 0 },
    pipeline: { brightness: 0, contrast: 0, gamma: 1, ditheringMode: 'threshold', inverted: false, imageMode: 'threshold' },
  };
  const lines = generateRasterScanlines(bitmap, rasterSettings);
  const powers = lines.flatMap(l => l.segments.map(s => s.power));
  assert(powers.length > 0, 'threshold mode produces burn segments');
  assert(powers.every(p => p === 0 || p === 100), '1-bit threshold raster uses only off or powerMax');
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`image-processing.test.ts: ${failed} assertion(s) failed`);
