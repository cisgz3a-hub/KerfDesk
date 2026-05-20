/**
 * F45-08-005: Grid Array launch bounds must come from current selection bounds.
 *
 * Run: npx tsx tests/grid-array-source-bounds.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { computeGridArraySourceBounds } from '../src/ui/hooks/useAppGeneratorWorkflows';

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

console.log('\n=== F45-08-005 grid array source bounds ===\n');

{
  const scene = createScene(200, 100, 'Grid Source Bounds');
  const layerId = scene.layers[0].id;
  const first = createRect(layerId, 20, 10, 10, 5);
  const second = createRect(layerId, 60, 25, 15, 15);
  const unselected = createRect(layerId, 120, 80, 40, 10);
  const bounds = computeGridArraySourceBounds(
    { ...scene, objects: [first, second, unselected] },
    new Set([first.id, second.id]),
  );

  assert(bounds != null, 'Selected objects produce grid-array source bounds');
  if (bounds) {
    approx(bounds.w, 55, 'Grid-array source width spans selected object bounds only');
    approx(bounds.h, 30, 'Grid-array source height spans selected object bounds only');
  }
}

{
  const scene = createScene(200, 100, 'No Selection');
  const bounds = computeGridArraySourceBounds(scene, new Set());
  assert(bounds === null, 'No selection produces no grid-array source bounds');
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${passed} assertions passed.`);
