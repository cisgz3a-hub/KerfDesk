/**
 * Core nesting remains available during temporary Pro access.
 * Run: npx tsx tests/nesting-throws-without-license.test.ts
 */
import { applyNesting, nestShapes } from '../src/core/nesting/Nester';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { entitlementService } from '../src/entitlements';
import type { EntitlementState } from '../src/entitlements';

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function setEntitlement(state: EntitlementState): void {
  (entitlementService as unknown as { state: EntitlementState }).state = state;
}

void (() => {
  console.log('\n=== nesting available during temporary Pro access ===\n');
  setEntitlement({ tier: 'free', hasPro: false });
  const scene = createScene(100, 100, 'Nesting gate');
  const rect = createRect(scene.layers[0].id, 1, 1, 10, 10);
  let nestErr = '';
  let applyErr = '';
  let result: unknown;
  let applied: unknown;
  try {
    result = nestShapes([rect], {
      binWidth: 100,
      binHeight: 100,
      padding: 1,
      edgeMargin: 1,
      rotationAllowed: false,
      sortMode: 'area',
    });
  } catch (e: unknown) {
    nestErr = e instanceof Error ? e.message : String(e);
  }
  try {
    applied = applyNesting([rect], { items: [], unplaced: [], efficiency: 0, binsUsed: 1 });
  } catch (e: unknown) {
    applyErr = e instanceof Error ? e.message : String(e);
  }
  assert(nestErr === '', 'nestShapes does not throw a Pro license error');
  assert(applyErr === '', 'applyNesting does not throw a Pro license error');
  assert(result != null, 'nestShapes returns a result under temporary Pro access');
  assert(applied != null, 'applyNesting returns objects under temporary Pro access');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
