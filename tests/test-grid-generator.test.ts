/**
 * Test grid G-code generator. Run: npx tsx tests/test-grid-generator.test.ts
 */

import {
  generateTestGrid,
  computeGridWidth,
  computeGridHeight,
  DEFAULT_TEST_GRID,
  type TestGridOptions,
} from '../src/core/tools/TestGridGenerator';

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

function assertClose(a: number, b: number, tol: number, message: string): void {
  assert(Math.abs(a - b) <= tol, message);
}

console.log('\n=== TestGridGenerator ===\n');

{
  const gcode = generateTestGrid(DEFAULT_TEST_GRID);
  assert(gcode.includes('G90'), 'generates valid G-code with G90');
  assert(gcode.includes('G21'), 'G21');
  assert(gcode.includes('M4 S0'), 'M4 S0');
  assert(gcode.includes('M5'), 'M5');
  assert(gcode.includes('G0 X0 Y0'), 'G0 X0 Y0');
}

{
  const opts: TestGridOptions = {
    ...DEFAULT_TEST_GRID,
    powers: [500, 1500, 3000],
    speeds: [1000],
    maxSpindle: 1000,
    includeLabels: false,
  };
  const gcode = generateTestGrid(opts);
  assert(gcode.includes('S500'), 'S500 present');
  assert(gcode.includes('S1000'), 'clamped S1000');
  assert(!gcode.includes('S1500'), 'no S1500');
  assert(!gcode.includes('S3000'), 'no S3000');
}

{
  const opts: TestGridOptions = {
    ...DEFAULT_TEST_GRID,
    powers: [100, 500, 1000],
    speeds: [500, 1500, 3000, 6000],
    includeLabels: false,
  };
  const gcode = generateTestGrid(opts);
  const cellMarkers = (gcode.match(/; Cell power=/g) || []).length;
  assert(cellMarkers === 3 * 4, `cell count ${cellMarkers} === 12`);
}

{
  const singlePass = generateTestGrid({
    ...DEFAULT_TEST_GRID,
    powers: [500],
    speeds: [1000],
    passes: 1,
    includeLabels: false,
  });
  const triplePass = generateTestGrid({
    ...DEFAULT_TEST_GRID,
    powers: [500],
    speeds: [1000],
    passes: 3,
    includeLabels: false,
  });
  const singleG1s = (singlePass.match(/G1 X/g) || []).length;
  const tripleG1s = (triplePass.match(/G1 X/g) || []).length;
  assert(tripleG1s > singleG1s * 2, 'triple pass has more G1 X than single');
}

{
  const opts: TestGridOptions = {
    ...DEFAULT_TEST_GRID,
    powers: [100, 500, 1000],
    speeds: [500, 1000, 2000, 3000],
    cellSizeMm: 10,
    cellGapMm: 2,
    includeLabels: false,
  };
  const w = computeGridWidth(opts);
  const h = computeGridHeight(opts);
  assertClose(w, 46, 0.01, 'grid width 46mm');
  assertClose(h, 38, 0.01, 'grid height 38mm');
}

{
  const opts: TestGridOptions = {
    ...DEFAULT_TEST_GRID,
    powers: [500],
    speeds: [1000],
    originX: 50,
    originY: 100,
    includeLabels: false,
  };
  const gcode = generateTestGrid(opts);
  assert(gcode.includes('X50.000'), 'origin X 50');
  assert(gcode.includes('Y100.000'), 'origin Y 100');
}

{
  const opts: TestGridOptions = {
    ...DEFAULT_TEST_GRID,
    powers: [500],
    speeds: [1000],
    originX: 50,
    originY: 100,
    includeLabels: true,
  };
  const gcode = generateTestGrid(opts);
  assert(gcode.includes('X56.000'), 'label margin shifts X');
  assert(gcode.includes('Y106.000'), 'label margin shifts Y');
}

{
  const opts: TestGridOptions = {
    ...DEFAULT_TEST_GRID,
    powers: [100, 500],
    speeds: [1000, 2000],
    includeLabels: true,
  };
  const gcode = generateTestGrid(opts);
  assert(gcode.includes('; --- Labels ---'), 'labels section');
  const g1Count = (gcode.match(/G1/g) || []).length;
  assert(g1Count > 50, 'labels add many G1 moves');
}

{
  const gcode = generateTestGrid(DEFAULT_TEST_GRID);
  assert(!gcode.includes('NaN'), 'no NaN');
  assert(!gcode.includes('Infinity'), 'no Infinity');
  assert(!gcode.includes('undefined'), 'no undefined');
}

{
  const coarse = generateTestGrid({
    ...DEFAULT_TEST_GRID,
    powers: [500],
    speeds: [1000],
    lineIntervalMm: 1.0,
    includeLabels: false,
  });
  const fine = generateTestGrid({
    ...DEFAULT_TEST_GRID,
    powers: [500],
    speeds: [1000],
    lineIntervalMm: 0.1,
    includeLabels: false,
  });
  const coarseLines = (coarse.match(/G1 X/g) || []).length;
  const fineLines = (fine.match(/G1 X/g) || []).length;
  assert(fineLines > coarseLines * 3, 'finer interval yields more scan lines');
}

console.log(`\n=== Summary ===\nPassed: ${passed}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
