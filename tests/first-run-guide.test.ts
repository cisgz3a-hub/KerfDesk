/**
 * T3-69: guided first-run test job foundation.
 *
 * Run: npx tsx tests/first-run-guide.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import {
  FIRST_RUN_GUIDE_STEPS,
  createFirstRunTestScene,
  markFirstRunGuideComplete,
  shouldShowFirstRunGuide,
  type FirstRunGuideStorage,
} from '../src/onboarding/FirstRunGuide';

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

function memoryStorage(): FirstRunGuideStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

console.log('\n=== T3-69 first-run guide ===\n');

{
  assert(FIRST_RUN_GUIDE_STEPS.length === 7, 'guide has seven first-safe-test steps');
  assert(FIRST_RUN_GUIDE_STEPS[0].id === 'place-scrap', 'first step starts with scrap material');
  assert(FIRST_RUN_GUIDE_STEPS[3].id === 'set-origin', 'guide includes Set zero point step');
  assert(FIRST_RUN_GUIDE_STEPS[4].id === 'frame', 'guide includes Frame step');
  assert(FIRST_RUN_GUIDE_STEPS[5].id === 'run-test', 'guide includes low-power test step');
  assert(FIRST_RUN_GUIDE_STEPS.every(step => step.title.length > 0 && step.body.length > 0), 'each guide step has user-facing content');
}

{
  const storage = memoryStorage();
  assert(shouldShowFirstRunGuide(storage), 'guide shows when completion marker is absent');
  markFirstRunGuideComplete(storage);
  assert(!shouldShowFirstRunGuide(storage), 'guide stays hidden after completion marker is written');
}

{
  const base = createScene(400, 300, 'Base');
  base.metadata.deviceProfileId = 'profile-1';
  const testScene = createFirstRunTestScene(base);
  const layer = testScene.layers[0];
  const square = testScene.objects[0];

  assert(testScene !== base, 'test scene returns a new scene reference');
  assert(base.objects.length === 0, 'test scene builder does not mutate the base scene');
  assert(testScene.canvas.width === 400 && testScene.canvas.height === 300, 'test scene keeps the machine bed size');
  assert(testScene.metadata.deviceProfileId === 'profile-1', 'test scene preserves device profile binding');
  assert(testScene.metadata.name === 'First safe test', 'test scene names the guided test project');
  assert(testScene.material === null, 'test scene does not create a fake material board');
  assert(testScene.layers.length === 1 && layer.settings.mode === 'score', 'test scene uses one low-power score layer');
  assert(layer.settings.power.max === 8, 'test scene caps power at 8 percent');
  assert(layer.settings.speed === 1200, 'test scene uses a conservative speed');
  assert(square.type === 'rect', 'test scene creates a rectangle');
  assert(square.name === '20 mm first test square', 'test scene labels the square clearly');
  assert(square.geometry.type === 'rect' && square.geometry.width === 20 && square.geometry.height === 20, 'test square is 20 mm by 20 mm');
  assert(square.layerId === layer.id && testScene.activeLayerId === layer.id, 'test square is on the active guide layer');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
