/**
 * T1-177 (external audit High #7): when a fill operation produces
 * zero scanline rows, `planFillOperation` must throw a typed
 * `FillProducedNoRowsError` instead of silently falling back to
 * outline tracing.
 *
 * Pre-T1-177 evidence (PlanOptimizer.ts:580-596):
 *
 *   if (allRows.length === 0 && boundaryPaths.length > 0) {
 *     console.warn(`... falling back to outline trace ...`);
 *     // build moves from `orderPathsForCutting + planPath` (CUT semantics)
 *     return movesOut;
 *   }
 *
 * A user who chose "engrave fill" got an outline CUT instead — a
 * different manufacturing operation with different material outcome.
 * On a 2 mm × 2 mm square with `fillInterval = 5 mm`, the user's
 * engrave intent silently became a perimeter cut. On thin material
 * the laser cuts THROUGH the boundary.
 *
 * Post-T1-177: throw `FillProducedNoRowsError` carrying diagnostic
 * info (fillMode, interval, fillAngles, boundaryPathCount). The
 * thrown error propagates up through `optimizePlan` → compile UI as
 * a compile failure. The user must adjust the fill interval or shape
 * size before the job can compile.
 *
 * Run: npx tsx tests/fill-no-rows-throws-not-outline-fallback.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  optimizePlan,
  FillProducedNoRowsError,
  type FillProducedNoRowsDiagnostics,
} from '../src/core/plan/PlanOptimizer';
import {
  createEmptyJob,
  flatPathFromPoints,
  type Operation,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';

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

const here = dirname(fileURLToPath(import.meta.url));

function fillSettings(overrides: Partial<ResolvedLaserSettings> = {}): ResolvedLaserSettings {
  return {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    passes: 1,
    zStepPerPass: 0,
    fillInterval: 5, // intentionally large so a 2x2mm square produces 0 rows
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
    ...overrides,
  };
}

/**
 * Build a tiny square fill operation whose interval is too large to
 * produce rows regardless of fill angle. The shape is 1 mm × 1 mm so
 * its longest dimension (diagonal, ~1.41 mm) is still less than the
 * 5 mm fill interval — no angle of scanline can fit inside it.
 */
function tinyFillOperation(overrides: Partial<ResolvedLaserSettings> = {}): Operation {
  const boundary = flatPathFromPoints(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ],
    true,
    'tiny-fill-boundary',
  );
  return {
    id: 'op-fill-tiny',
    layerId: 'L-fill',
    layerName: 'Tiny Fill',
    layerColor: '#aa00ff',
    order: 0,
    type: 'engrave',
    settings: fillSettings(overrides),
    geometry: { type: 'fill', paths: [boundary] },
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  } as unknown as Operation;
}

console.log('\n=== T1-177 fill produces no rows → throws (no outline fallback) ===\n');

// -------- 1. Throws FillProducedNoRowsError --------
{
  const job = createEmptyJob('T1-177-tiny-fill', 'test-project');
  job.operations = [tinyFillOperation()];
  job.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  let caught: FillProducedNoRowsError | null = null;
  try {
    optimizePlan(job);
  } catch (e) {
    caught = e instanceof FillProducedNoRowsError ? e : null;
  }
  assert(caught !== null, 'tiny-fill: optimizePlan throws FillProducedNoRowsError when no rows are produced');
}

// -------- 2. Diagnostics carry the right info --------
{
  const job = createEmptyJob('T1-177-tiny-fill-diag', 'test-project');
  job.operations = [tinyFillOperation({ fillInterval: 5, fillAngle: 30, fillMode: 'line' })];
  job.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  try {
    optimizePlan(job);
    assert(false, 'expected throw but optimizePlan returned normally');
  } catch (e) {
    if (e instanceof FillProducedNoRowsError) {
      const d: FillProducedNoRowsDiagnostics = e.diagnostics;
      assert(d.fillMode === 'line', `diagnostics.fillMode === 'line' (got '${d.fillMode}')`);
      assert(d.interval === 5, `diagnostics.interval === 5 (got ${d.interval})`);
      assert(d.boundaryPathCount === 1, `diagnostics.boundaryPathCount === 1 (got ${d.boundaryPathCount})`);
      assert(d.fillAngles.length === 1 && d.fillAngles[0] === 30, `line mode: 1 angle (30), got ${JSON.stringify(d.fillAngles)}`);
    } else {
      assert(false, `expected FillProducedNoRowsError, got ${e}`);
    }
  }
}

// -------- 3. Cross-hatch mode reports both angles --------
{
  const job = createEmptyJob('T1-177-tiny-cross', 'test-project');
  job.operations = [tinyFillOperation({ fillInterval: 5, fillAngle: 0, fillMode: 'cross-hatch' })];
  job.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  try {
    optimizePlan(job);
    assert(false, 'expected throw but optimizePlan returned normally');
  } catch (e) {
    if (e instanceof FillProducedNoRowsError) {
      const d = e.diagnostics;
      assert(d.fillMode === 'cross-hatch', 'cross-hatch: diagnostics.fillMode propagates');
      assert(
        d.fillAngles.length === 2 && d.fillAngles[0] === 0 && d.fillAngles[1] === 90,
        `cross-hatch: 2 angles [0, 90], got ${JSON.stringify(d.fillAngles)}`,
      );
    } else {
      assert(false, `expected FillProducedNoRowsError, got ${e}`);
    }
  }
}

// -------- 4. Message includes the remediation hint --------
{
  const job = createEmptyJob('T1-177-tiny-msg', 'test-project');
  job.operations = [tinyFillOperation()];
  job.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  try {
    optimizePlan(job);
    assert(false, 'expected throw');
  } catch (e) {
    if (e instanceof FillProducedNoRowsError) {
      assert(
        /Reduce the fill interval or increase the shape size/i.test(e.message),
        'error.message includes the remediation hint',
      );
      assert(
        /silently mutated engrave-fill intent into a cut operation/i.test(e.message),
        'error.message explains why the outline fallback was removed (the audit-driven rationale)',
      );
      assert(
        e.name === 'FillProducedNoRowsError',
        `error.name === 'FillProducedNoRowsError' (got '${e.name}')`,
      );
    }
  }
}

// -------- 5. Fill that DOES produce rows still works (regression bait) --------
{
  // 100 mm × 100 mm square with 1 mm interval → ~100 scanlines. Should
  // optimize without throwing.
  const boundary = flatPathFromPoints(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ],
    true,
    'big-fill-boundary',
  );
  const operation = {
    id: 'op-fill-big',
    layerId: 'L-fill',
    layerName: 'Big Fill',
    layerColor: '#aa00ff',
    order: 0,
    type: 'engrave',
    settings: fillSettings({ fillInterval: 1 }),
    geometry: { type: 'fill', paths: [boundary] },
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  } as unknown as Operation;

  const job = createEmptyJob('T1-177-big-fill', 'test-project');
  job.operations = [operation];
  job.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  let threw = false;
  try {
    const plan = optimizePlan(job);
    assert(plan.operations.length === 1, 'big-fill: plan has 1 operation');
    assert(plan.operations[0].moves.length > 0, 'big-fill: plan has moves (fill produced rows)');
  } catch {
    threw = true;
  }
  assert(!threw, 'big-fill: optimizePlan does NOT throw when scanlines are produced');
}

// -------- 6. Source pins on the implementation --------
{
  const src = readFileSync(resolve(here, '../src/core/plan/PlanOptimizer.ts'), 'utf-8');

  assert(/T1-177/.test(src), 'PlanOptimizer carries T1-177 marker');
  assert(
    /audit High #7|external audit High #7/.test(src),
    'PlanOptimizer cross-references audit High #7',
  );

  // The error class is exported.
  assert(
    /export class FillProducedNoRowsError extends Error/.test(src),
    'FillProducedNoRowsError class exported',
  );
  assert(
    /export interface FillProducedNoRowsDiagnostics/.test(src),
    'FillProducedNoRowsDiagnostics interface exported',
  );

  // The pre-T1-177 outline-fallback block is gone. We check for the
  // distinctive "falling back to outline trace" message that the
  // pre-fix branch logged.
  assert(
    !/falling back to outline trace/.test(src),
    'pre-T1-177 "falling back to outline trace" console.warn is gone',
  );

  // The pre-T1-177 fallback used `orderPathsForCutting(boundaryPaths,
  // pos, false, false)` followed by `planPath(...)`. The new branch
  // throws instead.
  const fallbackPattern = /allRows\.length === 0 && boundaryPaths\.length > 0[\s\S]{0,400}orderPathsForCutting/;
  assert(
    !fallbackPattern.test(src),
    'pre-T1-177 outline-trace fallback (orderPathsForCutting in the zero-rows branch) is gone',
  );

  // The new branch throws the typed error.
  assert(
    /allRows\.length === 0 && boundaryPaths\.length > 0[\s\S]{0,400}throw new FillProducedNoRowsError/.test(src),
    'zero-rows branch throws FillProducedNoRowsError',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
