/**
 * Operation ordering: containment, mode groups, NN, compile flag.
 * Run: npx tsx tests/operation-ordering.test.ts
 */

import { compileJob } from '../src/core/job/JobCompiler';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { createRect } from '../src/core/scene/SceneObject';
import {
  bboxFullyContains,
  orderOperations,
  sortShapesOriginalOrder,
  type OrderableShape,
} from '../src/core/plan/OperationOrderer';

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

function shape(
  id: string,
  mode: OrderableShape['mode'],
  box: { minX: number; minY: number; maxX: number; maxY: number },
  start: { x: number; y: number },
  layerIndex: number,
  sceneIndex: number,
): OrderableShape {
  return {
    id,
    mode,
    boundingBox: box,
    startPoint: start,
    endPoint: { ...start },
    layerIndex,
    sceneIndex,
    settingsKey: 'k',
  };
}

console.log('\n=== sortShapesOriginalOrder ===');
{
  const late = shape('late', 'engrave', { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { x: 0, y: 0 }, 0, 10);
  const early = shape('early', 'engrave', { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { x: 0, y: 0 }, 0, 2);
  const o = sortShapesOriginalOrder([late, early]);
  assert(o[0].id === 'early' && o[1].id === 'late', 'original order sorts by layerIndex then sceneIndex');
}

console.log('\n=== Containment: inner cut before outer ===');
{
  const outer = shape('outer', 'cut', { minX: 0, minY: 0, maxX: 100, maxY: 100 }, { x: 0, y: 0 }, 0, 0);
  const inner = shape('inner', 'cut', { minX: 40, minY: 40, maxX: 60, maxY: 60 }, { x: 50, y: 50 }, 0, 1);
  assert(bboxFullyContains(outer.boundingBox, inner.boundingBox), 'outer bbox contains inner');
  const ord = orderOperations([outer, inner]);
  assert(ord[0].id === 'inner' && ord[1].id === 'outer', 'inner cut ordered before containing outer');
}

console.log('\n=== Engrave before cut ===');
{
  const e = shape('e', 'engrave', { minX: 0, minY: 0, maxX: 10, maxY: 10 }, { x: 0, y: 0 }, 0, 0);
  const c = shape('c', 'cut', { minX: 0, minY: 0, maxX: 10, maxY: 10 }, { x: 5, y: 5 }, 1, 1);
  const ord = orderOperations([c, e]);
  assert(ord[0].mode === 'engrave' && ord[1].mode === 'cut', 'engrave precedes cut regardless of input order');
}

console.log('\n=== Nearest-neighbor X ordering ===');
{
  const a = shape('a', 'engrave', { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { x: 0, y: 0 }, 0, 0);
  const b = shape('b', 'engrave', { minX: 50, minY: 0, maxX: 51, maxY: 1 }, { x: 50, y: 0 }, 0, 1);
  const c = shape('c', 'engrave', { minX: 100, minY: 0, maxX: 101, maxY: 1 }, { x: 100, y: 0 }, 0, 2);
  const ord = orderOperations([c, a, b]);
  assert(ord[0].id === 'a' && ord[1].id === 'b' && ord[2].id === 'c', 'NN follows increasing X from origin');
}

console.log('\n=== engrave + inner + outer ===');
{
  const e = shape('e', 'engrave', { minX: 0, minY: 0, maxX: 5, maxY: 5 }, { x: 0, y: 0 }, 0, 0);
  const outer = shape('o', 'cut', { minX: 0, minY: 0, maxX: 100, maxY: 100 }, { x: 0, y: 0 }, 2, 3);
  const inner = shape('i', 'cut', { minX: 40, minY: 40, maxX: 60, maxY: 60 }, { x: 50, y: 50 }, 2, 2);
  const ord = orderOperations([outer, inner, e]);
  assert(ord[0].mode === 'engrave', 'first is engrave');
  assert(ord[1].id === 'i' && ord[2].id === 'o', 'inner cut then outer cut');
}

console.log('\n=== Identical bbox tiebreak ===');
{
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const a = shape('a', 'engrave', box, { x: 0, y: 0 }, 1, 5);
  const b = shape('b', 'engrave', box, { x: 0, y: 0 }, 0, 3);
  const ord = orderOperations([a, b]);
  assert(ord[0].id === 'b' && ord[1].id === 'a', 'lower layerIndex first, then sceneIndex');
}

console.log('\n=== compileJob optimizeOrder false preserves layer batching ===');
{
  const scene = createScene(200, 200, 'Order test');
  scene.compileOptions = { optimizeOrder: false };
  const cut = createLayer(0, 'cut', 'Cut');
  scene.layers = [cut];
  scene.activeLayerId = cut.id;
  const r1 = createRect(cut.id, 0, 0, 10, 10, 'A');
  const r2 = createRect(cut.id, 50, 0, 10, 10, 'B');
  scene.objects = [r1, r2];
  const job = compileJob(scene);
  assert(job.operations.length === 1, 'single batched cut operation when optimizeOrder is false');
  if (job.operations[0].geometry.type === 'vector') {
    assert(job.operations[0].geometry.paths.length === 2, 'both rects in one op');
  }
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`operation-ordering.test.ts: ${failed} failed`);
