/**
 * F45-06-001: rotated nesting application must match the planned item bounds.
 *
 * Run: npx tsx tests/nesting-rotation-apply.test.ts
 */
import { applyNesting, nestShapes } from '../src/core/nesting/Nester';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { computeObjectBounds } from '../src/geometry/bounds';
import { entitlementService } from '../src/entitlements';
import type { EntitlementState } from '../src/entitlements';

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

function assertClose(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.001, `${message} (got ${actual}, expected ${expected})`);
}

function setEntitlement(state: EntitlementState): void {
  (entitlementService as unknown as { state: EntitlementState }).state = state;
}

console.log('\n=== nesting rotated apply bounds ===\n');

setEntitlement({ tier: 'paid', hasPro: true, features: ['nesting'] });

{
  const scene = createScene(80, 60, 'rotation proof');
  const layerId = scene.layers[0].id;
  const tallRect = createRect(layerId, 10, 10, 50, 70);

  const result = nestShapes([tallRect], {
    binWidth: 80,
    binHeight: 60,
    padding: 0,
    edgeMargin: 0,
    rotationAllowed: true,
    sortMode: 'area',
  });

  assert(result.items.length === 1, 'rotated-fit object is placed');
  const item = result.items[0];
  assert(item?.rotated === true, 'object is marked rotated');
  assertClose(item?.x ?? NaN, 0, 'planned rotated item x');
  assertClose(item?.y ?? NaN, 0, 'planned rotated item y');
  assertClose(item?.width ?? NaN, 70, 'planned rotated item width');
  assertClose(item?.height ?? NaN, 50, 'planned rotated item height');

  const [applied] = applyNesting([tallRect], result);
  const bounds = computeObjectBounds(applied);

  assertClose(bounds.minX, item.x, 'applied rotated bounds minX matches planned x');
  assertClose(bounds.minY, item.y, 'applied rotated bounds minY matches planned y');
  assertClose(bounds.maxX, item.x + item.width, 'applied rotated bounds maxX matches planned right edge');
  assertClose(bounds.maxY, item.y + item.height, 'applied rotated bounds maxY matches planned bottom edge');
  assert(bounds.minX >= 0 && bounds.minY >= 0, 'applied rotated object stays inside bin origin');
  assert(bounds.maxX <= 80 && bounds.maxY <= 60, 'applied rotated object stays inside bin extents');
}

{
  const scene = createScene(80, 60, 'rotation disabled proof');
  const layerId = scene.layers[0].id;
  const tallRect = createRect(layerId, 10, 10, 50, 70);

  const result = nestShapes([tallRect], {
    binWidth: 80,
    binHeight: 60,
    padding: 0,
    edgeMargin: 0,
    rotationAllowed: false,
    sortMode: 'area',
  });

  assert(result.items.length === 0, 'same object is not placed when rotation is disabled');
  assert(result.unplaced.includes(tallRect.id), 'same object is reported unplaced without rotation');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
