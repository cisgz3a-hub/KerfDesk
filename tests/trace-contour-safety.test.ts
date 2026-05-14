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

assert(DEFAULT_TRACE_OPTIONS.turdsize === 8, 'default trace speckle filter is conservative');

const adapterSource = readFileSync(resolve('src/import/trace/ImageTracerAdapter.ts'), 'utf8');
const workerSource = readFileSync(resolve('src/import/trace/trace.worker.ts'), 'utf8');
for (const [label, source] of [
  ['adapter', adapterSource],
  ['worker', workerSource],
] as const) {
  assert(/linefilter:\s*true/.test(source), `${label}: linefilter is enabled`);
  assert(/rightangleenhance:\s*false/.test(source), `${label}: right-angle enhancement is disabled for general tracing`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
