/**
 * Scanning offset interpolation and endpoint adjustment.
 * Run: node node_modules/tsx/dist/cli.mjs tests/scanning-offset.test.ts
 */

import {
  interpolateOffset,
  applyScanOffset,
  suggestedDefaultTable,
  EMPTY_OFFSET_TABLE,
  type ScanningOffsetTable,
} from '../src/core/plan/ScanningOffset';

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

function assertClose(actual: number, expected: number, tol: number, message: string): void {
  assert(Math.abs(actual - expected) < tol, `${message} (got ${actual}, expected ~${expected})`);
}

console.log('\n=== ScanningOffset ===\n');

assert(interpolateOffset(EMPTY_OFFSET_TABLE, 3000) === 0, 'empty table → 0');

{
  const table: ScanningOffsetTable = [
    { speedMmPerMin: 1000, offsetMm: 0.1 },
    { speedMmPerMin: 3000, offsetMm: 0.3 },
  ];
  assertClose(interpolateOffset(table, 2000), 0.2, 1e-4, 'interp 2000');
  assertClose(interpolateOffset(table, 1000), 0.1, 1e-4, 'interp 1000');
  assertClose(interpolateOffset(table, 3000), 0.3, 1e-4, 'interp 3000');
}

{
  const table: ScanningOffsetTable = [
    { speedMmPerMin: 3000, offsetMm: 0.3 },
    { speedMmPerMin: 6000, offsetMm: 0.6 },
  ];
  assertClose(interpolateOffset(table, 1500), 0.15, 1e-4, 'extrap below');
  assertClose(interpolateOffset(table, 9000), 0.9, 1e-4, 'extrap above');
}

{
  const table: ScanningOffsetTable = [{ speedMmPerMin: 5000, offsetMm: 0.25 }];
  assertClose(interpolateOffset(table, 2500), 0.125, 1e-4, 'single point half');
  assertClose(interpolateOffset(table, 5000), 0.25, 1e-4, 'single point full');
  assertClose(interpolateOffset(table, 10000), 0.5, 1e-4, 'single point double speed');
}

{
  const table: ScanningOffsetTable = [
    { speedMmPerMin: 6000, offsetMm: 0.6 },
    { speedMmPerMin: 1000, offsetMm: 0.1 },
    { speedMmPerMin: 3000, offsetMm: 0.3 },
  ];
  assertClose(interpolateOffset(table, 2000), 0.2, 1e-4, 'unsorted input');
}

{
  const table: ScanningOffsetTable = [{ speedMmPerMin: 3000, offsetMm: 0.3 }];
  assertClose(interpolateOffset(table, 0), 0, 1e-4, 'speed 0');
}

{
  const r = applyScanOffset(10, 20, 0.05);
  assertClose(r.startX, 9.95, 1e-4, '+X start');
  assertClose(r.endX, 19.95, 1e-4, '+X end');
}

{
  const r = applyScanOffset(20, 10, 0.05);
  assertClose(r.startX, 20.05, 1e-4, '-X start');
  assertClose(r.endX, 10.05, 1e-4, '-X end');
}

{
  const r = applyScanOffset(10, 20, 0);
  assert(r.startX === 10 && r.endX === 20, 'identity offset 0');
}

{
  const table = suggestedDefaultTable();
  assert(table.length > 0, 'suggested non-empty');
  for (const p of table) {
    assert(p.speedMmPerMin > 0, `speed > 0 (${p.speedMmPerMin})`);
    assert(p.offsetMm >= 0, `offset >= 0 (${p.offsetMm})`);
  }
}

console.log(`\n=== Summary ===\nPassed: ${passed}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
