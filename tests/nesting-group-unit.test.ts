/**
 * F45-06-002: Auto-Pack must preserve grouped artwork as one nestable unit.
 *
 * Run: npx tsx tests/nesting-group-unit.test.ts
 */
import { nestShapes, applyNesting } from '../src/core/nesting/Nester';
import { createScene } from '../src/core/scene/Scene';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';
import { groupObjects } from '../src/core/scene/SceneOps';
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

function boundsOf(object: SceneObject): ReturnType<typeof computeObjectBounds> {
  const bounds = computeObjectBounds(object);
  if (!bounds) throw new Error(`missing bounds for ${object.id}`);
  return bounds;
}

function groupedChildren(objects: SceneObject[], groupId: string): SceneObject[] {
  return objects.filter(object => object.parentId === groupId).sort((a, b) => a.id.localeCompare(b.id));
}

console.log('\n=== F45-06-002 nesting grouped objects as one unit ===\n');

setEntitlement({ tier: 'paid', hasPro: true, features: ['nesting'] });

{
  let scene = createScene(80, 40, 'group nest proof');
  const layerId = scene.layers[0]!.id;
  const a = { ...createRect(layerId, 0, 0, 30, 10), id: 'child-a' };
  const b = { ...createRect(layerId, 0, 15, 30, 10), id: 'child-b' };
  scene = { ...scene, objects: [a, b] };
  scene = groupObjects(scene, new Set([a.id, b.id]), { groupId: 'grp' });

  const beforeChildren = groupedChildren(scene.objects, 'grp');
  const beforeA = boundsOf(beforeChildren[0]!);
  const beforeB = boundsOf(beforeChildren[1]!);
  const beforeDelta = {
    x: beforeB.minX - beforeA.minX,
    y: beforeB.minY - beforeA.minY,
  };

  const result = nestShapes(scene.objects, {
    binWidth: 80,
    binHeight: 40,
    padding: 0,
    edgeMargin: 0,
    rotationAllowed: false,
    sortMode: 'area',
  });

  assert(result.items.length === 1, 'grouped children produce one nestable item');
  assert(result.items[0]?.objectId === 'grp', 'group object id is the nestable item id');

  const after = applyNesting(scene.objects, result);
  const afterChildren = groupedChildren(after, 'grp');
  const afterA = boundsOf(afterChildren[0]!);
  const afterB = boundsOf(afterChildren[1]!);
  assert(afterB.minX - afterA.minX === beforeDelta.x, 'grouped children preserve relative X offset');
  assert(afterB.minY - afterA.minY === beforeDelta.y, 'grouped children preserve relative Y offset');
}

{
  const scene = createScene(80, 40, 'ungrouped nest proof');
  const layerId = scene.layers[0]!.id;
  const a = { ...createRect(layerId, 0, 0, 30, 10), id: 'loose-a' };
  const b = { ...createRect(layerId, 0, 15, 30, 10), id: 'loose-b' };

  const result = nestShapes([a, b], {
    binWidth: 80,
    binHeight: 40,
    padding: 0,
    edgeMargin: 0,
    rotationAllowed: false,
    sortMode: 'area',
  });

  assert(result.items.length === 2, 'ungrouped objects still pack independently');
  assert(result.items.some(item => item.objectId === 'loose-a'), 'ungrouped first object has its own item');
  assert(result.items.some(item => item.objectId === 'loose-b'), 'ungrouped second object has its own item');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
