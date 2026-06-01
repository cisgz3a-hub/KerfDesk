/**
 * LightBurn/Potrace bitmap-stage contracts for image tracing.
 *
 * Run: node --import tsx tests/trace-lightburn-bitmap.test.ts
 */
import {
  grayscaleToTraceBitmap,
  removeSmallInkRegions,
  traceBitmapToImageData,
} from '../src/import/trace/TraceBitmap';

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

function assertArrayEqual(actual: ArrayLike<number>, expected: readonly number[], message: string): void {
  const actualArray = Array.from(actual);
  const ok = actualArray.length === expected.length
    && actualArray.every((value, index) => value === expected[index]);
  assert(ok, `${message}: expected [${expected.join(', ')}], got [${actualArray.join(', ')}]`);
}

console.log('\n=== LightBurn trace bitmap stage ===\n');

{
  const bitmap = grayscaleToTraceBitmap(
    new Uint8Array([0, 10, 64, 128, 129, 255]),
    6,
    1,
    { cutoff: 10, threshold: 128, turdsize: 0, invert: false },
  );

  assertArrayEqual(
    bitmap.data,
    [0, 1, 1, 1, 0, 0],
    'Cutoff/Threshold use the inclusive LightBurn brightness band',
  );
}

{
  const cleaned = removeSmallInkRegions({
    width: 5,
    height: 3,
    data: new Uint8Array([
      1, 0, 1, 1, 0,
      0, 0, 0, 0, 0,
      1, 1, 1, 0, 0,
    ]),
  }, 2);

  assertArrayEqual(
    cleaned.data,
    [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      1, 1, 1, 0, 0,
    ],
    'turdsize removes connected ink regions up to and including N pixels',
  );
}

{
  const rgba = traceBitmapToImageData({
    width: 3,
    height: 1,
    data: new Uint8Array([0, 1, 0]),
  });

  assertArrayEqual(
    rgba.data,
    [
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ],
    'trace bitmap encodes foreground as black RGBA pixels',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
