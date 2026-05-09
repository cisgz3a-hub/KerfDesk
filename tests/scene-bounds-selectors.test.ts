/**
 * T3-67: canonical scene and compiled-job bounds selectors.
 *
 * Run: npx tsx tests/scene-bounds-selectors.test.ts
 */
import { readFileSync } from 'node:fs';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';
import {
  selectSceneBounds,
  type BoundsMode,
} from '../src/core/scene/bounds';
import {
  compiledJobStateInitial,
  selectCompiledCanvasBounds,
  selectCompiledMachineBounds,
  type CompiledJobState,
} from '../src/app/CompiledJobState';
import type { AABB } from '../src/core/types';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

function assertAabb(actual: AABB, expected: AABB, message: string): void {
  assert(
    actual.minX === expected.minX &&
      actual.minY === expected.minY &&
      actual.maxX === expected.maxX &&
      actual.maxY === expected.maxY,
    `${message} (got ${JSON.stringify(actual)})`,
  );
}

function rect(
  layerId: string,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    ...createRect(layerId, x, y, w, h, id),
    id,
    ...overrides,
  };
}

function fixtureScene(): Scene {
  const scene = createScene(400, 300, 'T3-67 bounds selectors');
  const cut = createLayer(0, 'cut', 'Cut');
  const hiddenOutput = createLayer(1, 'engrave', 'Hidden output');
  hiddenOutput.visible = false;
  const guide = createLayer(2, 'score', 'Guide');
  guide.output = false;

  scene.layers = [cut, hiddenOutput, guide];
  scene.activeLayerId = cut.id;
  scene.objects = [
    rect(cut.id, 'locked-cut', 10, 20, 30, 40, { locked: true }),
    rect(hiddenOutput.id, 'hidden-layer-output', -50, -40, 10, 10),
    rect(guide.id, 'visible-guide', 100, 100, 20, 20),
    rect(cut.id, 'invisible-cut', 200, 200, 10, 10, { visible: false }),
  ];
  return scene;
}

function makeReadyState(): CompiledJobState {
  return {
    status: 'ready',
    requestId: 1,
    sceneHash: 'scene',
    profileHash: 'profile',
    compiledAt: 123,
    result: {
      gcode: 'G21',
      machinePlanBounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
      canvasPlanBounds: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
      ticket: { ticketId: 'ticket' },
    },
  };
}

console.log('\n=== T3-67 canonical bounds selectors ===\n');

{
  const scene = fixtureScene();
  const cases: Array<[BoundsMode, AABB]> = [
    ['visible', { minX: 10, minY: 20, maxX: 120, maxY: 120 }],
    ['output', { minX: 10, minY: 20, maxX: 40, maxY: 60 }],
    ['all', { minX: -50, minY: -40, maxX: 210, maxY: 210 }],
  ];
  for (const [mode, expected] of cases) {
    assertAabb(selectSceneBounds(scene, mode), expected, `${mode} mode returns canonical bounds`);
  }
}

{
  const scene = fixtureScene();
  assertAabb(
    selectSceneBounds(scene, 'selected', { selectedIds: new Set(['visible-guide']) }),
    { minX: 100, minY: 100, maxX: 120, maxY: 120 },
    'selected mode returns selected object bounds',
  );
  const empty = selectSceneBounds(scene, 'selected', { selectedIds: new Set() });
  assert(empty.minX === Infinity && empty.maxX === -Infinity, 'selected mode returns empty bounds with no selection');
}

{
  const source = readFileSync('src/ui/components/App.tsx', 'utf-8');
  assert(source.includes('selectSceneBounds'), 'App.tsx uses selectSceneBounds for output/frame bounds');
  assert(!source.includes('computeOutputBounds'), 'App.tsx no longer imports computeOutputBounds directly');
}

{
  const ready = makeReadyState();
  assertAabb(
    selectCompiledMachineBounds(ready) ?? { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN },
    { minX: 1, minY: 2, maxX: 3, maxY: 4 },
    'selectCompiledMachineBounds returns ready machine bounds',
  );
  assertAabb(
    selectCompiledCanvasBounds(ready) ?? { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN },
    { minX: 10, minY: 20, maxX: 30, maxY: 40 },
    'selectCompiledCanvasBounds returns ready canvas bounds',
  );
  assert(selectCompiledMachineBounds(compiledJobStateInitial) === null, 'compiled machine bounds are null before compile');
  assert(selectCompiledCanvasBounds(compiledJobStateInitial) === null, 'compiled canvas bounds are null before compile');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
