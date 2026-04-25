/**
 * JobCompiler preserves Pro-only executable settings with a Pro entitlement.
 * Run: npx tsx tests/jobcompiler-keeps-pro-settings-with-license.test.ts
 */
import { compileJob } from '../src/core/job/JobCompiler';
import { createLayer } from '../src/core/scene/Layer';
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
  console.log('\n=== JobCompiler keeps Pro settings with license ===\n');
  setEntitlement({ tier: 'paid', hasPro: true });

  const scene = createScene(300, 200, 'Pro settings kept');
  scene.compileOptions = { optimizeOrder: false };
  const cutLayer = scene.layers[0];
  cutLayer.settings.cut.overcut = 5;
  cutLayer.settings.cut.leadIn = 2;
  cutLayer.settings.tabs = { enabled: true, count: 3, width: 4, height: 1 };

  const engraveLayer = createLayer(1, 'engrave', 'Cross Hatch');
  engraveLayer.settings.fill.mode = 'cross-hatch';
  scene.layers.push(engraveLayer);

  const cutObj = createRect(cutLayer.id, 10, 20, 30, 40, 'Cut');
  cutObj.powerScale = 0.5;
  cutObj.cutStartIndex = 2;
  const engraveObj = createRect(engraveLayer.id, 60, 20, 30, 20, 'Engrave');
  scene.objects.push(cutObj, engraveObj);

  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  let job;
  try {
    job = compileJob(scene);
  } finally {
    console.warn = originalWarn;
  }

  const cutOp = job.operations.find(op => op.type === 'cut');
  const engraveOp = job.operations.find(op => op.type === 'engrave');
  assert(cutOp != null, 'cut operation compiled');
  assert(engraveOp != null, 'engrave operation compiled');
  if (!cutOp || !engraveOp) process.exit(1);

  assert(cutOp.settings.tabCount === 3, 'tabs preserved');
  assert(cutOp.settings.tabWidth === 4, 'tab width preserved');
  assert(cutOp.settings.overcut === 5, 'overcut preserved');
  assert(cutOp.settings.leadIn === 2, 'lead-in preserved');
  assert(engraveOp.settings.fillMode === 'cross-hatch', 'cross-hatch preserved');
  assert(
    cutOp.geometry.type === 'vector' && cutOp.geometry.paths.every(p => p.powerScale === 0.5),
    'powerScale preserved',
  );
  assert(!warns.some(w => w.includes('[entitlement]')), 'no entitlement warning emitted');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
