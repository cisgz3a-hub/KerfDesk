/**
 * F45-06-003: partial Auto-Pack results must not mutate the scene by default.
 *
 * Run: npx tsx tests/nesting-partial-apply-block.test.ts
 */
import { applyNesting, nestShapes } from '../src/core/nesting/Nester';
import { createScene } from '../src/core/scene/Scene';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';
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

function setEntitlement(state: EntitlementState): void {
  (entitlementService as unknown as { state: EntitlementState }).state = state;
}

function boundsSnapshot(objects: readonly SceneObject[]): string {
  return JSON.stringify(objects.map(object => ({
    id: object.id,
    bounds: computeObjectBounds(object),
  })));
}

console.log('\n=== F45-06-003 partial nesting apply is blocked ===\n');

setEntitlement({ tier: 'paid', hasPro: true, features: ['nesting'] });

{
  const scene = createScene(50, 50, 'partial nesting proof');
  const layerId = scene.layers[0]!.id;
  const big = { ...createRect(layerId, 0, 0, 60, 60), id: 'too-large' };
  const small = { ...createRect(layerId, 20, 20, 10, 10), id: 'small' };
  const objects = [big, small];

  const result = nestShapes(objects, {
    binWidth: 50,
    binHeight: 50,
    padding: 0,
    edgeMargin: 0,
    rotationAllowed: false,
    sortMode: 'area',
  });

  assert(result.items.length === 1, 'one fitting item is placed');
  assert(result.unplaced.includes('too-large'), 'oversized item is reported unplaced');

  const before = boundsSnapshot(objects);
  const after = applyNesting(objects, result);
  const afterSnapshot = boundsSnapshot(after);

  assert(afterSnapshot === before, 'partial apply leaves every object at its original bounds');
  assert(after[0] === big, 'unplaced object reference is unchanged');
  assert(after[1] === small, 'placed object is not moved when the result is partial');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
