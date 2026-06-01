/**
 * Potrace trace backend contracts.
 *
 * Run: node --import tsx tests/trace-potrace-backend.test.ts
 */
import { traceBitmapToSubPaths } from '../src/import/trace/PotraceTraceBackend';
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

console.log('\n=== Potrace trace backend ===\n');

{
  const bitmap: TraceBitmap = {
    width: 1,
    height: 1,
    data: new Uint8Array([1]),
  };

  const subPaths = traceBitmapToSubPaths(bitmap, {
    turdsize: 0,
    turnpolicy: 'minority',
    alphamax: 0,
    opttolerance: 0.2,
    optcurve: false,
  });

  assert(subPaths.length === 1, `single ink pixel traces to one subpath (${subPaths.length})`);
  assert(subPaths[0]?.closed === true, 'single ink pixel subpath is closed');
  assert(
    subPaths[0]?.segments.some(segment => segment.type === 'close'),
    'single ink pixel subpath has an explicit close segment',
  );
  assert(
    subPaths[0]?.segments.every(segment => segment.type !== 'cubic'),
    'alphamax=0 keeps the traced pixel boundary as straight segments',
  );
}

{
  const bitmap: TraceBitmap = {
    width: 3,
    height: 3,
    data: new Uint8Array([
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]),
  };

  const subPaths = traceBitmapToSubPaths(bitmap, {
    turdsize: 1,
    turnpolicy: 'minority',
    alphamax: 1,
    opttolerance: 0.2,
    optcurve: true,
  });

  assert(subPaths.length === 0, `backend applies Potrace area turdsize filtering (${subPaths.length})`);
}

{
  const width = 24;
  const height = 24;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - 11.5;
      const dy = y - 11.5;
      data[y * width + x] = dx * dx + dy * dy <= 8 * 8 ? 1 : 0;
    }
  }
  const bitmap: TraceBitmap = { width, height, data };

  const baseOptions = {
    turdsize: 0,
    turnpolicy: 'minority' as const,
    alphamax: 1,
    opttolerance: 0.2,
  };
  const unoptimized = traceBitmapToSubPaths(bitmap, { ...baseOptions, optcurve: false });
  const optimized = traceBitmapToSubPaths(bitmap, { ...baseOptions, optcurve: true });
  const countSegments = (subPaths: ReturnType<typeof traceBitmapToSubPaths>) =>
    subPaths.reduce((sum, subPath) => sum + subPath.segments.length, 0);

  assert(
    countSegments(optimized) < countSegments(unoptimized),
    'optcurve=true applies opttolerance by merging compatible Bezier segments',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
