/**
 * F45-08-003: Distribute commands must use object bounds, not transform origins.
 *
 * Run: npx tsx tests/distribute-selection-bounds-spacing.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';
import { computeObjectBounds } from '../src/geometry/bounds';
import { distributeSelection } from '../src/ui/hooks/useSceneOperations';

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

function makeScene(): {
  scene: ReturnType<typeof createScene>;
  wideLeft: SceneObject;
  narrowMiddle: SceneObject;
  wideRight: SceneObject;
  unselected: SceneObject;
  ids: Set<string>;
} {
  const base = createScene(240, 140, 'Distribute Objects');
  const layerId = base.layers[0].id;
  const wideLeft = createRect(layerId, 0, 0, 80, 10);
  const narrowMiddle = createRect(layerId, 90, 30, 5, 20);
  const wideRight = createRect(layerId, 100, 70, 80, 30);
  const unselected = createRect(layerId, 210, 100, 10, 10);
  return {
    scene: { ...base, objects: [wideLeft, narrowMiddle, wideRight, unselected] },
    wideLeft,
    narrowMiddle,
    wideRight,
    unselected,
    ids: new Set([wideLeft.id, narrowMiddle.id, wideRight.id]),
  };
}

console.log('\n=== F45-08-003 distribute selection by bounds ===\n');

{
  const { scene, wideLeft, narrowMiddle, wideRight, unselected, ids } = makeScene();
  const after = distributeSelection(scene, ids, 'horizontal');
  const left = bounds(byId(after.objects, wideLeft.id));
  const middle = bounds(byId(after.objects, narrowMiddle.id));
  const right = bounds(byId(after.objects, wideRight.id));
  const untouched = bounds(byId(after.objects, unselected.id));

  approx(left.minX, 0, 'Horizontal distribute keeps first object anchored');
  approx(right.maxX, 180, 'Horizontal distribute keeps last object anchored');
  approx(middle.minX - left.maxX, 7.5, 'Horizontal distribute creates first equal visible gap');
  approx(right.minX - middle.maxX, 7.5, 'Horizontal distribute creates second equal visible gap');
  approx(untouched.minX, 210, 'Horizontal distribute leaves unselected object unchanged');
}

{
  const { scene, wideLeft, narrowMiddle, wideRight, unselected, ids } = makeScene();
  const after = distributeSelection(scene, ids, 'vertical');
  const top = bounds(byId(after.objects, wideLeft.id));
  const middle = bounds(byId(after.objects, narrowMiddle.id));
  const bottom = bounds(byId(after.objects, wideRight.id));
  const untouched = bounds(byId(after.objects, unselected.id));

  approx(top.minY, 0, 'Vertical distribute keeps first object anchored');
  approx(bottom.maxY, 100, 'Vertical distribute keeps last object anchored');
  approx(middle.minY - top.maxY, 20, 'Vertical distribute creates first equal visible gap');
  approx(bottom.minY - middle.maxY, 20, 'Vertical distribute creates second equal visible gap');
  approx(untouched.minY, 100, 'Vertical distribute leaves unselected object unchanged');
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${passed} assertions passed.`);
