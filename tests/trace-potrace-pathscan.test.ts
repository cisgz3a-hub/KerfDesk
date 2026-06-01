/**
 * Potrace bitmap boundary-walk contracts.
 *
 * Run: node --import tsx tests/trace-potrace-pathscan.test.ts
 */
import { traceBitmapToPotracePaths } from '../src/import/trace/PotracePathScanner';
import type { TraceBitmap } from '../src/import/trace/TraceBitmap';

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

function assertPointArrayEqual(
  actual: readonly { x: number; y: number }[],
  expected: readonly { x: number; y: number }[],
  message: string,
): void {
  const ok = actual.length === expected.length
    && actual.every((point, index) => point.x === expected[index].x && point.y === expected[index].y);
  const printable = actual.map(point => `(${point.x},${point.y})`).join(' ');
  const expectedPrintable = expected.map(point => `(${point.x},${point.y})`).join(' ');
  assert(ok, `${message}: expected ${expectedPrintable}, got ${printable}`);
}

console.log('\n=== Potrace bitmap path scan ===\n');

{
  const bitmap: TraceBitmap = {
    width: 1,
    height: 1,
    data: new Uint8Array([1]),
  };

  const paths = traceBitmapToPotracePaths(bitmap, { turdsize: 0, turnpolicy: 'minority' });

  assert(paths.length === 1, `single ink pixel produces one closed path (${paths.length})`);
  assert(paths[0]?.area === 1, `single ink pixel path area is one pixel (${paths[0]?.area})`);
  assert(paths[0]?.sign === '+', `single ink pixel is a positive foreground path (${paths[0]?.sign})`);
  assertPointArrayEqual(
    paths[0]?.points ?? [],
    [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ],
    'single ink pixel walks its four boundary vertices',
  );
}

{
  const bitmap: TraceBitmap = {
    width: 2,
    height: 1,
    data: new Uint8Array([1, 1]),
  };

  const paths = traceBitmapToPotracePaths(bitmap, { turdsize: 0, turnpolicy: 'minority' });

  assert(paths.length === 1, `touching ink pixels produce one path (${paths.length})`);
  assert(paths[0]?.area === 2, `two-pixel rectangle path area is two pixels (${paths[0]?.area})`);
  assertPointArrayEqual(
    paths[0]?.points ?? [],
    [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
    ],
    'two-pixel rectangle walks the outer boundary only',
  );
}

{
  const bitmap: TraceBitmap = {
    width: 1,
    height: 1,
    data: new Uint8Array([1]),
  };

  const paths = traceBitmapToPotracePaths(bitmap, { turdsize: 1, turnpolicy: 'minority' });
  assert(paths.length === 0, `turdsize removes paths with area <= threshold (${paths.length})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
