/**
 * T1-165 (audit F-029): `optimizePlan` checks the abort signal only at
 * top-level operation boundaries pre-T1-165. Inside a single operation
 * (`planRasterOperation`, `planFillOperation`, `planPath`) the inner
 * scanline / row / segment loops ran to completion before the next
 * `throwIfOptimizeAborted` between operations fired.
 *
 * Real impact: a 12 MP raster produces ~4000 scanlines × ~100–1000
 * segments each in a SINGLE operation. Cancel-compile click in the
 * middle of that operation had to wait 5–30 s for the whole raster
 * to finish before the abort took effect.
 *
 * Post-T1-165 the signal is threaded into the inner functions:
 *  - `planRasterOperation` checks once per scanline (~4000 checks for
 *    a 12MP photo)
 *  - `planFillOperation` checks once per row (~10k checks for a large
 *    fill)
 *  - `planPath` checks once per path (paths can have 100k+ points
 *    after bezier flattening)
 *  - Vector-operation loop in `planOperation` checks between paths so
 *    multi-thousand-path operations also cancel in bounded time.
 *
 * The cooperative-cancellation semantics: when `signal.aborted` flips
 * to `true`, the next inner check throws `DOMException('Compile
 * cancelled', 'AbortError')`. The error bubbles out of `optimizePlan`
 * synchronously (the function is sync — no async cancel propagation
 * needed). Behavior on the abort-throw path is unchanged from the
 * existing top-level abort check.
 *
 * This test uses a custom abort signal whose `aborted` getter flips
 * to `true` on the Nth read. The outer per-operation check passes (the
 * first read returns `false`), then the new inner per-row / per-
 * scanline check fires on a subsequent read and throws.
 *
 * Run: npx tsx tests/plan-optimizer-mid-operation-cancel.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEmptyJob,
  flatPathFromPoints,
  type Operation,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { emptyAABB } from '../src/core/types';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function baseSettings(): ResolvedLaserSettings {
  return {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    passes: 1,
    zStepPerPass: 0,
    fillInterval: 0.5,
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
  };
}

/**
 * Custom abort signal whose `aborted` flips to true on the Nth read.
 * Lets us exercise inner-loop checks: outer per-operation check
 * reads first (sees false), then the inner per-row / per-scanline /
 * per-path check fires on a later read and trips.
 */
function makeAbortAfter(reads: number): AbortSignal {
  let count = 0;
  return {
    get aborted() {
      count++;
      return count > reads;
    },
    onabort: null,
    reason: undefined,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    throwIfAborted: () => {},
  } as unknown as AbortSignal;
}

/** Build a vector operation containing many small paths. */
function vectorOpWithManyPaths(pathCount: number): Operation {
  const paths = Array.from({ length: pathCount }, (_, i) =>
    flatPathFromPoints(
      [
        { x: i * 2, y: 0 },
        { x: i * 2 + 1, y: 0 },
      ],
      false,
      `obj-${i}`,
    ),
  );
  return {
    id: 'op-vector-many',
    layerId: 'layer-1',
    layerName: 'L1',
    layerColor: '#aa00ff',
    order: 0,
    type: 'cut',
    settings: baseSettings(),
    geometry: { type: 'vector', paths },
    bounds: { minX: 0, minY: 0, maxX: pathCount * 2, maxY: 0 },
  };
}

/** Build a fill operation with a large boundary so many scanlines fire. */
function fillOpLargeBoundary(): Operation {
  // 100 mm × 100 mm square @ 0.5 mm fillInterval → ~200 scanlines.
  const boundary = flatPathFromPoints(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ],
    true,
    'fill-boundary',
  );
  return {
    id: 'op-fill-large',
    layerId: 'layer-2',
    layerName: 'L2',
    layerColor: '#00aaff',
    order: 0,
    type: 'engrave',
    settings: baseSettings(),
    geometry: { type: 'fill', paths: [boundary] },
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  };
}

console.log('\n=== T1-165 PlanOptimizer mid-operation abort cancellation ===\n');

// -------- 1. Vector op with many paths: cancel mid-operation --------
{
  const job = createEmptyJob('T1-165-vec', 'test-project');
  job.operations = [vectorOpWithManyPaths(500)];
  job.bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 0 };

  // Allow the outer per-operation checks + the operation index loop
  // to read once or twice, then trip on a per-path inner check.
  const signal = makeAbortAfter(2);
  let threw = false;
  let err: unknown;
  try {
    optimizePlan(job, { signal });
  } catch (e) {
    threw = true;
    err = e;
  }
  assert(threw, 'vector mid-operation: optimizePlan throws on abort during a 500-path operation');
  assert(
    err instanceof DOMException && (err as DOMException).name === 'AbortError',
    'vector mid-operation: thrown error is an AbortError DOMException',
  );
}

// -------- 2. Fill op with many rows: cancel mid-operation --------
{
  const job = createEmptyJob('T1-165-fill', 'test-project');
  job.operations = [fillOpLargeBoundary()];
  job.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  const signal = makeAbortAfter(2);
  let threw = false;
  let err: unknown;
  try {
    optimizePlan(job, { signal });
  } catch (e) {
    threw = true;
    err = e;
  }
  assert(threw, 'fill mid-operation: optimizePlan throws on abort during a large fill operation');
  assert(
    err instanceof DOMException && (err as DOMException).name === 'AbortError',
    'fill mid-operation: thrown error is an AbortError DOMException',
  );
}

// -------- 3. Pre-aborted signal still throws (top-level check intact) --------
{
  const job = createEmptyJob('T1-165-preabort', 'test-project');
  job.operations = [vectorOpWithManyPaths(10)];
  job.bounds = { minX: 0, minY: 0, maxX: 20, maxY: 0 };

  const ac = new AbortController();
  ac.abort();
  let threw = false;
  let err: unknown;
  try {
    optimizePlan(job, { signal: ac.signal });
  } catch (e) {
    threw = true;
    err = e;
  }
  assert(threw, 'pre-abort: optimizePlan throws immediately on a pre-aborted signal');
  assert(
    err instanceof DOMException && (err as DOMException).name === 'AbortError',
    'pre-abort: error is AbortError DOMException',
  );
}

// -------- 4. No-signal path still works (backwards-compat) --------
{
  const job = createEmptyJob('T1-165-nosignal', 'test-project');
  job.operations = [vectorOpWithManyPaths(3)];
  job.bounds = { minX: 0, minY: 0, maxX: 6, maxY: 0 };

  const plan = optimizePlan(job);
  // Plan contains one PlannedOperation per pass (default passes=1)
  // per Operation in the Job. The Job here has one vector Operation.
  assert(plan.operations.length === 1, 'no-signal: optimizePlan still produces 1 PlannedOperation from the single vector op');
  assert(plan.operations[0].moves.length > 0, 'no-signal: PlannedOperation contains moves');
}

// -------- 5. Source pins on the threading change --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../src/core/plan/PlanOptimizer.ts'), 'utf-8');

  assert(/T1-165/.test(src), 'PlanOptimizer carries T1-165 marker');
  assert(/audit F-029/.test(src), 'PlanOptimizer cross-references audit F-029');

  // The new per-row check inside planFillOperation.
  assert(
    /for \(const row of allRows\) \{[\s\S]{0,400}throwIfOptimizeAborted\(signal\)/.test(src),
    'planFillOperation has a per-row throwIfOptimizeAborted check inside the allRows loop',
  );

  // The new per-scanline check inside planRasterOperation.
  assert(
    /for \(const scanline of scanlines\) \{[\s\S]{0,400}throwIfOptimizeAborted\(signal\)/.test(src),
    'planRasterOperation has a per-scanline throwIfOptimizeAborted check inside the scanlines loop',
  );

  // planPath now takes signal.
  assert(
    /function planPath\([\s\S]*?signal\?: AbortSignal/.test(src),
    'planPath signature accepts a signal parameter',
  );

  // Vector-operation between-paths check.
  assert(
    /for \(const \{ path, reversed \} of ordered\) \{[\s\S]{0,300}throwIfOptimizeAborted\(signal\)/.test(src),
    'planOperation vector path loop has a between-paths throwIfOptimizeAborted check',
  );

  // planOperation accepts signal.
  assert(
    /function planOperation\([\s\S]*?signal\?: AbortSignal/.test(src),
    'planOperation signature accepts a signal parameter',
  );

  // planRasterOperation accepts signal.
  assert(
    /function planRasterOperation\([\s\S]*?signal\?: AbortSignal/.test(src),
    'planRasterOperation signature accepts a signal parameter',
  );

  // planFillOperation accepts signal.
  assert(
    /function planFillOperation\([\s\S]*?signal\?: AbortSignal/.test(src),
    'planFillOperation signature accepts a signal parameter',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
