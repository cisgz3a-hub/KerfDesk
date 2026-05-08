/**
 * T3-13: Fill row generation should use scanline edge buckets instead of
 * rescanning every edge on every row. The behavior must stay identical for
 * ordinary filled geometry while the implementation shape avoids O(rows*edges).
 *
 * Run: npx tsx tests/fill-generator-active-edge-table.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateFillRows } from '../src/core/plan/FillGenerator';
import type { FlatPath } from '../src/core/job/Job';

function rect(id: string, x: number, y: number, w: number, h: number): FlatPath {
  return {
    id,
    coords: new Float64Array([
      x, y,
      x + w, y,
      x + w, y + h,
      x, y + h,
    ]),
    closed: true,
    direction: 'cw',
    bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h },
    parentId: null,
    powerScale: 1,
  };
}

console.log('\n=== T3-13 fill active-edge table ===\n');

{
  const rows = generateFillRows([rect('r', 0, 0, 10, 4)], {
    interval: 1,
    angle: 0,
    biDirectional: true,
    overscanning: 2,
  });

  assert.equal(rows.length, 4, '4mm-tall rectangle at 1mm interval produces 4 rows');
  assert.equal(rows[0].segments.length, 1, 'each rectangle row has one burn segment');
  assert.deepEqual(rows[0].segments[0].actualFrom, { x: 0, y: 0.5 }, 'first row left boundary unchanged');
  assert.deepEqual(rows[0].segments[0].actualTo, { x: 10, y: 0.5 }, 'first row right boundary unchanged');
  assert.deepEqual(rows[0].overscanFrom, { x: -2, y: 0.5 }, 'forward row overscan starts before boundary');
  assert.deepEqual(rows[0].overscanTo, { x: 12, y: 0.5 }, 'forward row overscan exits after boundary');
  assert.deepEqual(rows[1].segments[0].actualFrom, { x: 10, y: 1.5 }, 'bidirectional row reverses segment start');
  assert.deepEqual(rows[1].segments[0].actualTo, { x: 0, y: 1.5 }, 'bidirectional row reverses segment end');
  assert.deepEqual(rows[1].overscanFrom, { x: 12, y: 1.5 }, 'reversed row starts from right overscan');
  assert.deepEqual(rows[1].overscanTo, { x: -2, y: 1.5 }, 'reversed row exits to left overscan');
}

{
  const rows = generateFillRows([
    rect('left', 0, 0, 4, 4),
    rect('right', 6, 0, 4, 4),
  ], {
    interval: 2,
    angle: 0,
    biDirectional: false,
    overscanning: 0,
  });

  assert.equal(rows.length, 2, 'two same-height rectangles share two scan rows');
  assert.equal(rows[0].segments.length, 2, 'disjoint rectangles stay as two burn segments on one row');
  assert.deepEqual(
    rows[0].segments.map(s => [s.actualFrom.x, s.actualTo.x]),
    [[0, 4], [6, 10]],
    'even-odd pairing still preserves disjoint segment boundaries',
  );
}

{
  const source = readFileSync('src/core/plan/FillGenerator.ts', 'utf8');
  const generateRowsBlock = source.match(/export function generateFillRows[\s\S]*?\n}\n\n\/\*\*/)?.[0] ?? '';

  assert.match(source, /T3-13/, 'FillGenerator source carries the T3-13 marker');
  assert.match(source, /buildScanlineEdgeBuckets/, 'active-edge bucket builder exists');
  assert.match(source, /activeEdges/, 'generateFillRows keeps an active edge set');
  assert.doesNotMatch(
    generateRowsBlock,
    /findIntersections\(rotatedEdges,\s*y\)/,
    'generateFillRows no longer scans the full rotated edge list for every row',
  );
}

console.log('  ok active-edge table shape and fill-row behavior are pinned');
