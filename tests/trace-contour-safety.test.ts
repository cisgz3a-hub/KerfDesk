/**
 * Trace contour safety: dirty/partial image traces must not invent long
 * straight closing burn lines.
 *
 * Run: npx tsx tests/trace-contour-safety.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_TRACE_OPTIONS,
  contourToSubPath,
} from '../src/import/trace/PotraceTracer';

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

console.log('\n=== trace contour safety ===\n');

{
  const subPath = contourToSubPath([
    { type: 'POINT', x: 0, y: 0 },
    { type: 'POINT', x: 100, y: 0 },
  ]);
  assert(subPath !== null, 'open contour still produces a subpath');
  assert(subPath?.closed === false, 'far-apart contour endpoints are not marked closed');
  assert(
    subPath?.segments.every(segment => segment.type !== 'close'),
    'far-apart contour endpoints do not get a synthetic close segment',
  );
}

{
  const subPath = contourToSubPath([
    { type: 'POINT', x: 0, y: 0 },
    { type: 'POINT', x: 10, y: 0 },
    { type: 'POINT', x: 0.75, y: 0.75 },
  ]);
  assert(subPath !== null, 'near-closed contour produces a subpath');
  assert(subPath?.closed === true, 'near-closed contour remains closed');
  assert(
    subPath?.segments.some(segment => segment.type === 'close'),
    'near-closed contour keeps the explicit close segment',
  );
}

assert(DEFAULT_TRACE_OPTIONS.cutoff === 0, 'default trace cutoff matches LightBurn lower brightness bound');
assert(DEFAULT_TRACE_OPTIONS.threshold === 128, 'default trace threshold matches LightBurn upper brightness bound');
assert(DEFAULT_TRACE_OPTIONS.turdsize === 2, 'default trace speckle filter matches Potrace turdsize');
assert(DEFAULT_TRACE_OPTIONS.alphamax === 1.0, 'default trace smoothness maps to Potrace alphamax');
assert(DEFAULT_TRACE_OPTIONS.opttolerance === 0.2, 'default trace optimize maps to Potrace opttolerance');

const adapterSource = readFileSync(resolve('src/import/trace/ImageTracerAdapter.ts'), 'utf8');
const workerSource = readFileSync(resolve('src/import/trace/trace.worker.ts'), 'utf8');
const tracerSource = readFileSync(resolve('src/import/trace/PotraceTracer.ts'), 'utf8');
assert(
  /grayscaleToTraceBitmap/.test(tracerSource),
  'main-thread trace builds the shared LightBurn/Potrace bitmap stage',
);
assert(
  /grayscaleToTraceBitmap/.test(workerSource),
  'worker trace builds the shared LightBurn/Potrace bitmap stage',
);
assert(
  /traceBitmapToSubPaths/.test(tracerSource),
  'main-thread image trace uses the Potrace polygon/vertex backend',
);
assert(
  /traceBitmapToSubPaths/.test(workerSource),
  'worker image trace uses the Potrace polygon/vertex backend',
);
assert(/linefilter:\s*true/.test(adapterSource), 'adapter: linefilter is enabled for non-image trace users');
assert(/rightangleenhance:\s*false/.test(adapterSource), 'adapter: right-angle enhancement is disabled for non-image trace users');
assert(/pathomit:\s*turd/.test(adapterSource), 'adapter keeps caller-provided pathomit for non-image trace users');
assert(!/traceCanvas/.test(tracerSource), 'main-thread image trace no longer routes through ImageTracer fitting');
assert(!/imagetracerjs/.test(workerSource), 'worker image trace no longer routes through ImageTracer fitting');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
