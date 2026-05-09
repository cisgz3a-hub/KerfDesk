/**
 * T3-35: generated fill rows are cached by path fingerprint + fill settings.
 * Run: npx tsx tests/fill-rows-cache.test.ts
 */
import { readFileSync } from 'node:fs';
import type { FlatPath } from '../src/core/job/Job';
import {
  __getFillRowsCacheStatsForTest,
  __resetFillRowsCacheForTest,
  buildFillRowsCacheKey,
  generateFillRows,
  type FillSettings,
} from '../src/core/plan/FillGenerator';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const square: FlatPath = {
  id: 'square',
  coords: new Float64Array([0, 0, 20, 0, 20, 20, 0, 20]),
  closed: true,
  direction: 'cw',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
  parentId: null,
  powerScale: 1,
};

const settings: FillSettings = {
  interval: 2,
  angle: 0,
  biDirectional: false,
  overscanning: 1,
};

console.log('\n=== T3-35 fill rows cache ===\n');

__resetFillRowsCacheForTest();

{
  const first = generateFillRows([square], settings);
  const afterFirst = __getFillRowsCacheStatsForTest();
  assert(first.length > 0, 'first generation returns fill rows');
  assert(afterFirst.misses === 1, 'first generation is a cache miss');
  assert(afterFirst.hits === 0, 'first generation has no hits');

  const second = generateFillRows([square], settings);
  const afterSecond = __getFillRowsCacheStatsForTest();
  assert(second.length === first.length, 'second generation returns same row count');
  assert(afterSecond.hits === 1, 'second generation hits the cache');
  assert(afterSecond.misses === 1, 'second generation does not add a miss');
}

{
  const rows = generateFillRows([square], settings);
  rows[0].segments[0].actualFrom.x = 999;

  const fresh = generateFillRows([square], settings);
  assert(
    fresh[0].segments[0].actualFrom.x !== 999,
    'cached fill rows are cloned so caller mutation cannot poison the cache',
  );
}

{
  const before = __getFillRowsCacheStatsForTest();
  generateFillRows([square], { ...settings, interval: 1 });
  const after = __getFillRowsCacheStatsForTest();
  assert(after.misses === before.misses + 1, 'changing fill interval invalidates the cache key');
}

{
  const keyA = buildFillRowsCacheKey([square], settings, 0);
  const keyB = buildFillRowsCacheKey([
    { ...square, coords: new Float64Array([...Array.from(square.coords), 10, 10]) },
  ], settings, 0);
  const keyC = buildFillRowsCacheKey([square], { ...settings, biDirectional: true }, 1);
  assert(keyA !== keyB, 'path fingerprint affects cache key');
  assert(keyA !== keyC, 'fill settings and initial row index affect cache key');
}

{
  const source = readFileSync('src/core/plan/FillGenerator.ts', 'utf8');
  assert(source.includes('T3-35'), 'FillGenerator carries T3-35 marker');
  assert(source.includes('FILL_ROWS_CACHE_MAX'), 'FillGenerator bounds the fill-row cache');
  assert(source.includes('buildFillRowsCacheKey'), 'FillGenerator exposes stable fill-row cache key builder');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
