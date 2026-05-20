/**
 * F45-08-001: Align commands must align selected objects to each other.
 *
 * Run: npx tsx tests/align-selection-object-to-object.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';
import { computeObjectBounds } from '../src/geometry/bounds';
import { alignSelection } from '../src/ui/hooks/useSceneOperations';

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

function approx(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-9, `${message} (got ${actual}, expected ${expected})`);
}

function makeScene(): {
  scene: ReturnType<typeof createScene>;
  a: SceneObject;
  b: SceneObject;
  c: SceneObject;
  ids: Set<string>;
} {
  const base = createScene(200, 100, 'Align Objects');
  const layerId = base.layers[0].id;
  const a = createRect(layerId, 20, 10, 10, 10);
  const b = createRect(layerId, 80, 20, 20, 10);
  const c = createRect(layerId, 150, 40, 5, 5);
  return {
    scene: { ...base, objects: [a, b, c] },
    a,
    b,
    c,
    ids: new Set([a.id, b.id]),
  };
}

function byId(objects: readonly SceneObject[], id: string): SceneObject {
  const obj = objects.find(candidate => candidate.id === id);
  if (!obj) throw new Error(`missing object ${id}`);
  return obj;
}

function bounds(obj: SceneObject) {
  const b = computeObjectBounds(obj);
  if (!b) throw new Error(`missing bounds for ${obj.id}`);
  return b;
}

function centerX(obj: SceneObject): number {
  const b = bounds(obj);
  return (b.minX + b.maxX) / 2;
}

function centerY(obj: SceneObject): number {
  const b = bounds(obj);
  return (b.minY + b.maxY) / 2;
}

console.log('\n=== F45-08-001 align selection object-to-object ===\n');

{
  const { scene, a, b, c, ids } = makeScene();
  const after = alignSelection(scene, ids, 'left');
  approx(bounds(byId(after.objects, a.id)).minX, 20, 'Align Left keeps leftmost selected edge as anchor');
  approx(bounds(byId(after.objects, b.id)).minX, 20, 'Align Left moves other selected object to the anchor edge');
  approx(bounds(byId(after.objects, c.id)).minX, 150, 'Align Left leaves unselected object unchanged');
}

{
  const { scene, a, b, ids } = makeScene();
  const after = alignSelection(scene, ids, 'right');
  approx(bounds(byId(after.objects, a.id)).maxX, 100, 'Align Right moves other selected object to rightmost anchor edge');
  approx(bounds(byId(after.objects, b.id)).maxX, 100, 'Align Right keeps rightmost selected edge as anchor');
}

{
  const { scene, a, b, ids } = makeScene();
  const after = alignSelection(scene, ids, 'top');
  approx(bounds(byId(after.objects, a.id)).minY, 10, 'Align Top keeps top selected edge as anchor');
  approx(bounds(byId(after.objects, b.id)).minY, 10, 'Align Top moves other selected object to the anchor edge');
}

{
  const { scene, a, b, ids } = makeScene();
  const after = alignSelection(scene, ids, 'bottom');
  approx(bounds(byId(after.objects, a.id)).maxY, 30, 'Align Bottom moves other selected object to bottom anchor edge');
  approx(bounds(byId(after.objects, b.id)).maxY, 30, 'Align Bottom keeps bottom selected edge as anchor');
}

{
  const { scene, a, b, ids } = makeScene();
  const after = alignSelection(scene, ids, 'centerX');
  approx(centerX(byId(after.objects, a.id)), 60, 'Align Center X moves first object center to selection center');
  approx(centerX(byId(after.objects, b.id)), 60, 'Align Center X moves second object center to selection center');
}

{
  const { scene, a, b, ids } = makeScene();
  const after = alignSelection(scene, ids, 'centerY');
  approx(centerY(byId(after.objects, a.id)), 20, 'Align Center Y moves first object center to selection center');
  approx(centerY(byId(after.objects, b.id)), 20, 'Align Center Y moves second object center to selection center');
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${passed} assertions passed.`);
