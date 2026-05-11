/**
 * T1-150: regression test for the pure snap helpers extracted from
 * CanvasViewport. These power the canvas drag-snap and shape-creation
 * UX — if a user drags an object near another object's corner, the
 * drag commits to the snapped position instead of the cursor's exact
 * position.
 *
 * Run: npx tsx tests/canvas-snap-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SceneObject } from '../src/core/scene/SceneObject';
import {
  findSnapPoint,
  getObjectSnapPoints,
  snapToGrid,
} from '../src/ui/components/canvas/canvasSnapHelpers';

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

function rectObj(id: string, x: number, y: number, w: number, h: number): SceneObject {
  return {
    id,
    visible: true,
    locked: false,
    selected: false,
    layerId: 'l1',
    name: id,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'rect', x, y, width: w, height: h, cornerRadius: 0 },
  } as unknown as SceneObject;
}

console.log('\n=== T1-150 canvas snap helpers ===\n');

// -------- snapToGrid --------
assert(snapToGrid(5.3, 1) === 5, 'snapToGrid(5.3, 1) = 5 (round to nearest)');
assert(snapToGrid(5.7, 1) === 6, 'snapToGrid(5.7, 1) = 6');
assert(snapToGrid(5.5, 1) === 6, 'snapToGrid(5.5, 1) = 6 (round half up)');
assert(snapToGrid(12, 5) === 10, 'snapToGrid(12, 5) = 10 (multiple of 5)');
assert(snapToGrid(13, 5) === 15, 'snapToGrid(13, 5) = 15');
assert(snapToGrid(5.3, 0) === 5.3, 'snapToGrid with gridSize=0 → unchanged (snap off)');
assert(snapToGrid(5.3, -1) === 5.3, 'snapToGrid with negative gridSize → unchanged');
assert(snapToGrid(-5.3, 1) === -5, 'snapToGrid(-5.3, 1) = -5');

// -------- getObjectSnapPoints: rect (9 points) --------
{
  const r = rectObj('r1', 0, 0, 100, 50);
  const pts = getObjectSnapPoints(r);
  assert(pts.length === 9, 'rect → 9 snap points');
  // 4 corners
  assert(pts.some((p) => p.x === 0 && p.y === 0), 'rect: top-left corner');
  assert(pts.some((p) => p.x === 100 && p.y === 0), 'rect: top-right corner');
  assert(pts.some((p) => p.x === 100 && p.y === 50), 'rect: bottom-right corner');
  assert(pts.some((p) => p.x === 0 && p.y === 50), 'rect: bottom-left corner');
  // center
  assert(pts.some((p) => p.x === 50 && p.y === 25), 'rect: center');
  // 4 edge midpoints
  assert(pts.some((p) => p.x === 50 && p.y === 0), 'rect: top midpoint');
  assert(pts.some((p) => p.x === 100 && p.y === 25), 'rect: right midpoint');
  assert(pts.some((p) => p.x === 50 && p.y === 50), 'rect: bottom midpoint');
  assert(pts.some((p) => p.x === 0 && p.y === 25), 'rect: left midpoint');
}

// -------- getObjectSnapPoints: rect with translation --------
{
  const r = rectObj('r1', 10, 20, 30, 40);
  const t = (r as { transform: { tx: number; ty: number } }).transform;
  t.tx = 100;
  t.ty = 200;
  const pts = getObjectSnapPoints(r);
  // Top-left corner = (a*x + tx, d*y + ty) = (1*10+100, 1*20+200) = (110, 220)
  assert(pts.some((p) => p.x === 110 && p.y === 220),
    'translated rect: top-left corner shifted by transform');
}

// -------- getObjectSnapPoints: ellipse (5 points) --------
{
  const e: SceneObject = {
    id: 'e1',
    visible: true,
    locked: false,
    selected: false,
    layerId: 'l1',
    name: 'e1',
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'ellipse', cx: 50, cy: 50, rx: 10, ry: 5 },
  } as unknown as SceneObject;
  const pts = getObjectSnapPoints(e);
  assert(pts.length === 5, 'ellipse → 5 snap points (center + 4 cardinals)');
  assert(pts.some((p) => p.x === 50 && p.y === 50), 'ellipse: center');
  assert(pts.some((p) => p.x === 40 && p.y === 50), 'ellipse: left (cx - rx)');
  assert(pts.some((p) => p.x === 60 && p.y === 50), 'ellipse: right (cx + rx)');
  assert(pts.some((p) => p.x === 50 && p.y === 45), 'ellipse: top (cy - ry)');
  assert(pts.some((p) => p.x === 50 && p.y === 55), 'ellipse: bottom (cy + ry)');
}

// -------- getObjectSnapPoints: line (3 points) --------
{
  const ln: SceneObject = {
    id: 'l1',
    visible: true,
    locked: false,
    selected: false,
    layerId: 'l1',
    name: 'l1',
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'line', x1: 0, y1: 0, x2: 100, y2: 50 },
  } as unknown as SceneObject;
  const pts = getObjectSnapPoints(ln);
  assert(pts.length === 3, 'line → 3 snap points (2 endpoints + midpoint)');
  assert(pts.some((p) => p.x === 0 && p.y === 0), 'line: start endpoint');
  assert(pts.some((p) => p.x === 100 && p.y === 50), 'line: end endpoint');
  assert(pts.some((p) => p.x === 50 && p.y === 25), 'line: midpoint');
}

// -------- getObjectSnapPoints: polygon (every vertex) --------
{
  const pg: SceneObject = {
    id: 'p1',
    visible: true,
    locked: false,
    selected: false,
    layerId: 'l1',
    name: 'p1',
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], closed: true },
  } as unknown as SceneObject;
  const pts = getObjectSnapPoints(pg);
  assert(pts.length === 3, 'polygon → vertex count snap points');
}

// -------- getObjectSnapPoints: unknown type fallback --------
{
  const obj: SceneObject = {
    id: 'x1',
    visible: true,
    locked: false,
    selected: false,
    layerId: 'l1',
    name: 'x1',
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 7, ty: 11 },
    geometry: { type: 'text' } as never,
  } as unknown as SceneObject;
  const pts = getObjectSnapPoints(obj);
  assert(pts.length === 1, 'unknown type → 1 snap point (origin fallback)');
  assert(pts[0].x === 7 && pts[0].y === 11,
    'fallback uses transform origin (tx, ty)');
}

// -------- findSnapPoint --------
{
  const r = rectObj('r1', 0, 0, 100, 100);
  // Query near (102, 0) — should snap to (100, 0) corner
  const result = findSnapPoint(102, 0, new Set(), [r], 5);
  assert(result.snapped, 'snaps to nearest corner within snapDist');
  assert(result.x === 100 && result.y === 0,
    'snapped to top-right corner (100, 0)');
}

// -------- findSnapPoint: no objects within snapDist --------
{
  const r = rectObj('r1', 0, 0, 100, 100);
  const result = findSnapPoint(500, 500, new Set(), [r], 5);
  assert(!result.snapped, 'too far → not snapped');
  assert(result.x === 500 && result.y === 500,
    'unsnapped → returns input coords');
}

// -------- findSnapPoint: excluded IDs skipped --------
{
  const r = rectObj('r1', 0, 0, 100, 100);
  const result = findSnapPoint(102, 0, new Set(['r1']), [r], 5);
  assert(!result.snapped, 'excluded object → no snap');
}

// -------- findSnapPoint: invisible objects skipped --------
{
  const r = rectObj('r1', 0, 0, 100, 100);
  (r as { visible: boolean }).visible = false;
  const result = findSnapPoint(102, 0, new Set(), [r], 5);
  assert(!result.snapped, 'invisible object → no snap');
}

// -------- findSnapPoint: picks closest of multiple candidates --------
{
  const r1 = rectObj('a', 0, 0, 10, 10);    // corners at (0,0)(10,0)(10,10)(0,10)
  const r2 = rectObj('b', 100, 0, 10, 10);  // corners at (100,0)(110,0) etc.
  // Query (12, 0) — closer to r1's (10,0) than r2's (100,0)
  const result = findSnapPoint(12, 0, new Set(), [r1, r2], 10);
  assert(result.snapped && result.x === 10 && result.y === 0,
    'picks closer corner among multiple candidates');
}

// -------- Source-level pin: CanvasViewport delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const cvSrc = readFileSync(
    resolve(here, '../src/ui/components/CanvasViewport.tsx'),
    'utf-8',
  );
  assert(/from '\.\/canvas\/canvasSnapHelpers'/.test(cvSrc),
    'CanvasViewport imports from canvas/canvasSnapHelpers');
  assert(/T1-150/.test(cvSrc),
    'CanvasViewport carries T1-150 marker');
  assert(!/^function snapToGrid/m.test(cvSrc),
    'inline snapToGrid is gone from CanvasViewport');
  assert(!/^function getObjectSnapPoints/m.test(cvSrc),
    'inline getObjectSnapPoints is gone');
  assert(!/^function findSnapPoint/m.test(cvSrc),
    'inline findSnapPoint is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/canvas/canvasSnapHelpers.ts'),
    'utf-8',
  );
  assert(/T1-150/.test(helperSrc),
    'canvasSnapHelpers carries T1-150 marker');
  for (const name of ['snapToGrid', 'getObjectSnapPoints', 'findSnapPoint']) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
