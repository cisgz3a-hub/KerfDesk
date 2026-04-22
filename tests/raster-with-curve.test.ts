import { luminanceToLaserPower } from '../src/core/plan/RasterGenerator';
import { type ResponseCurve } from '../src/core/materials/ResponseCurve';

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

const curve: ResponseCurve = {
  id: 'resp_test',
  materialName: 'Test',
  calibrationSpeed: 3000,
  calibratedAt: '2026-04-22T00:00:00.000Z',
  points: [
    { commandedPower: 0, observedDarkness: 0 },
    { commandedPower: 60, observedDarkness: 0.5 },
    { commandedPower: 100, observedDarkness: 1 },
  ],
};

console.log('\n=== Raster with curve: fallback compatibility ===');
{
  let identical = true;
  for (let p = 0; p <= 255; p += 5) {
    const oldValue = Math.round(20 + (80 - 20) * (1 - p / 255));
    const newValue = luminanceToLaserPower(p, 20, 80);
    if (oldValue !== newValue) {
      identical = false;
      break;
    }
  }
  assert(identical, 'luminanceToLaserPower without curve matches old behavior');
}

console.log('\n=== Raster with curve: interpolation ===');
{
  const midLum = 128; // darkness ~0.498
  const mapped = luminanceToLaserPower(midLum, 0, 100, curve);
  assert(Math.abs(mapped - 60) <= 1, 'with curve, uses inverse interpolation near midpoint');
}

console.log('\n=== Raster with curve: clamping to layer min/max ===');
{
  const darkPixel = 0;
  const lightPixel = 255;
  const darkMapped = luminanceToLaserPower(darkPixel, 30, 70, curve);
  const lightMapped = luminanceToLaserPower(lightPixel, 30, 70, curve);
  assert(darkMapped <= 70 && darkMapped >= 30, 'dark pixel power clamped to [powerMin, powerMax]');
  assert(lightMapped <= 70 && lightMapped >= 30, 'light pixel power clamped to [powerMin, powerMax]');
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`raster-with-curve.test.ts: ${failed} assertion(s) failed`);
process.exit(0);
