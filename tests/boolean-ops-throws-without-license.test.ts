/**
 * Core boolean ops refuse free-tier use.
 * Run: npx tsx tests/boolean-ops-throws-without-license.test.ts
 */
import { booleanOperation } from '../src/geometry/BooleanOps';
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
  console.log('\n=== boolean ops throw without license ===\n');
  setEntitlement({ tier: 'free', hasPro: false });
  const scene = createScene(100, 100, 'Boolean gate');
  const a = createRect(scene.layers[0].id, 0, 0, 20, 20);
  const b = createRect(scene.layers[0].id, 10, 10, 20, 20);
  let err = '';
  try {
    booleanOperation(a, b, 'union');
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(/pro license/i.test(err), 'booleanOperation throws Pro license error');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
