/**
 * T1-156: regression test for the pure scanline-rasterizer
 * primitives extracted from FillGenerator. The scanline algorithm
 * is the load-bearing engraving + fill-pattern rasterizer; the
 * primitives must preserve byte-identical behavior across the
 * extraction.
 *
 * Run: npx tsx tests/fill-geometry-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlatPath } from '../src/core/job/Job';
import {
  buildScanlineEdgeBuckets,
  extractEdges,
  findActiveIntersections,
  findIntersections,
  rotatePoint,
  type Edge,
  type ScanlineEdge,
} from '../src/core/plan/fillGeometryHelpers';

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

function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function flatPath(coords: number[]): FlatPath {
  return { coords, closed: true } as unknown as FlatPath;
}

console.log('\n=== T1-156 fill geometry helpers ===\n');

// -------- extractEdges --------
{
  // 10×10 square: 4 vertices → 4 edges (closing edge wraps)
  const edges = extractEdges([flatPath([0, 0, 10, 0, 10, 10, 0, 10])]);
  assert(edges.length === 4, 'square (4 vertices) → 4 edges (with closing)');
  // First edge: (0,0) → (10,0)
  assert(edges[0].x1 === 0 && edges[0].y1 === 0 && edges[0].x2 === 10 && edges[0].y2 === 0,
    'first edge: (0,0) → (10,0)');
  // Last edge: (0,10) → (0,0) (closing wrap)
  assert(edges[3].x1 === 0 && edges[3].y1 === 10 && edges[3].x2 === 0 && edges[3].y2 === 0,
    'last edge wraps from (0,10) back to (0,0)');
}

// -------- extractEdges: skip paths with <2 points --------
{
  const edges = extractEdges([flatPath([5, 5])]);
  assert(edges.length === 0, 'path with 1 point → no edges');
  const edges2 = extractEdges([flatPath([])]);
  assert(edges2.length === 0, 'empty path → no edges');
}

// -------- findIntersections: horizontal edges skipped --------
{
  const horizontal: Edge = { x1: 0, y1: 5, x2: 10, y2: 5 };
  const r = findIntersections([horizontal], 5);
  assert(r.length === 0, 'horizontal edge at y=5 → no crossings at y=5');
}

// -------- findIntersections: typical case --------
{
  const edges: Edge[] = [
    { x1: 0, y1: 0, x2: 0, y2: 10 },   // left vertical
    { x1: 10, y1: 0, x2: 10, y2: 10 }, // right vertical
  ];
  const r = findIntersections(edges, 5);
  assert(r.length === 2, 'horizontal ray at y=5 crosses both verticals');
  // X = 0 and X = 10 (order = edge order)
  assert(r.includes(0) && r.includes(10),
    'crossings are at x=0 and x=10');
}

// -------- findIntersections: y at vertex (strict-on-one-end avoids double count) --------
{
  // Two edges sharing a vertex at y=5
  const edges: Edge[] = [
    { x1: 0, y1: 0, x2: 5, y2: 5 },
    { x1: 5, y1: 5, x2: 10, y2: 0 },
  ];
  const r = findIntersections(edges, 5);
  // With strict inequality on yMax end, only one edge counts the
  // shared vertex (the one where y=5 is the LOWER endpoint).
  assert(r.length <= 1,
    'vertex at y=5 not double-counted (one edge or zero)');
}

// -------- findIntersections: y outside edge range --------
{
  const edges: Edge[] = [{ x1: 0, y1: 0, x2: 10, y2: 5 }];
  assert(findIntersections(edges, -1).length === 0, 'y below range → 0');
  assert(findIntersections(edges, 100).length === 0, 'y above range → 0');
}

// -------- buildScanlineEdgeBuckets --------
{
  // Square with rowCount = 5, startY = 0, interval = 2
  // Rows are at y = 0, 2, 4, 6, 8.
  // Square top edge at y=0, bottom at y=10.
  // Vertical edges should be bucketed correctly.
  const edges: Edge[] = [
    { x1: 0, y1: 0, x2: 0, y2: 10 },   // left vertical: spans rows 0..5
    { x1: 10, y1: 0, x2: 10, y2: 10 }, // right vertical: same
  ];
  const { addAt, removeAt } = buildScanlineEdgeBuckets(edges, 0, 2, 5);
  // Both edges enter at row 0 (yMin=0, startY=0, ceil(0/2)=0)
  assert(addAt[0].length === 2, 'both verticals added at row 0');
  assert(addAt[1].length === 0, 'no new edges at row 1');
  // leaveRow = min(5, ceil(10/2)) = 5 — at the cap, so not pushed
  // into removeAt[5] (leaveRow < rowCount is false). Edges stay
  // active for all 5 rows.
  for (let i = 0; i < 5; i++) {
    assert(removeAt[i].length === 0,
      `no edges removed at row ${i} (leaveRow=5 caps to rowCount, no remove)`);
  }
}

// -------- buildScanlineEdgeBuckets: rowCount=0 → empty buckets --------
{
  const r = buildScanlineEdgeBuckets([], 0, 1, 0);
  assert(r.addAt.length === 0 && r.removeAt.length === 0,
    'rowCount=0 → empty bucket arrays');
}

// -------- buildScanlineEdgeBuckets: interval=0 → empty --------
{
  const r = buildScanlineEdgeBuckets(
    [{ x1: 0, y1: 0, x2: 10, y2: 10 }],
    0, 0, 5,
  );
  // interval=0 short-circuits before iterating edges
  assert(r.addAt.flat().length === 0, 'interval=0 → no edges bucketed');
}

// -------- findActiveIntersections --------
{
  const active: ScanlineEdge[] = [
    { x1: 0, y1: 0, x2: 0, y2: 10, enterRow: 0, leaveRow: 5 },
    { x1: 10, y1: 0, x2: 10, y2: 10, enterRow: 0, leaveRow: 5 },
  ];
  const r = findActiveIntersections(active, 5);
  assert(r.length === 2,
    'active subset intersection: 2 crossings at y=5');
}

// -------- rotatePoint --------
{
  // 90° rotation: (1, 0) → (0, 1)
  const r1 = rotatePoint(1, 0, Math.PI / 2);
  assert(approxEqual(r1.x, 0) && approxEqual(r1.y, 1),
    '90° rotate (1, 0) → (0, 1)');

  // 180° rotation: (3, 4) → (-3, -4)
  const r2 = rotatePoint(3, 4, Math.PI);
  assert(approxEqual(r2.x, -3) && approxEqual(r2.y, -4),
    '180° rotate (3, 4) → (-3, -4)');

  // 0° rotation: identity
  const r3 = rotatePoint(7, 11, 0);
  assert(approxEqual(r3.x, 7) && approxEqual(r3.y, 11),
    '0° rotate → identity');

  // 360° rotation: back to original
  const r4 = rotatePoint(5, 5, Math.PI * 2);
  assert(approxEqual(r4.x, 5) && approxEqual(r4.y, 5),
    '360° rotate → back to original');
}

// -------- Source-level pin: FillGenerator delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const fgSrc = readFileSync(
    resolve(here, '../src/core/plan/FillGenerator.ts'),
    'utf-8',
  );
  assert(/from '\.\/fillGeometryHelpers'/.test(fgSrc),
    'FillGenerator imports from ./fillGeometryHelpers');
  assert(/T1-156/.test(fgSrc),
    'FillGenerator carries T1-156 marker');
  for (const name of [
    'extractEdges',
    'findIntersections',
    'buildScanlineEdgeBuckets',
    'findActiveIntersections',
    'rotatePoint',
  ]) {
    const re = new RegExp(`^function ${name}\\b`, 'm');
    assert(!re.test(fgSrc),
      `inline ${name} is gone from FillGenerator`);
  }
  // Inline Edge / ScanlineEdge gone
  assert(!/^interface Edge \{$/m.test(fgSrc),
    'inline Edge interface is gone');
  assert(!/^interface ScanlineEdge\b/m.test(fgSrc),
    'inline ScanlineEdge interface is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/core/plan/fillGeometryHelpers.ts'),
    'utf-8',
  );
  assert(/T1-156/.test(helperSrc),
    'fillGeometryHelpers carries T1-156 marker');
  for (const name of [
    'extractEdges',
    'findIntersections',
    'buildScanlineEdgeBuckets',
    'findActiveIntersections',
    'rotatePoint',
  ]) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
