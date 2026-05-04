/**
 * T1-62: jobModePlanSummary returns the planned operation order for
 * multi-mode jobs ("Engrave → Cut") and null for single-mode / no-objects
 * jobs (where the existing activeLabel already names the operation).
 * Mirrors PlanOptimizer's fixed engrave/score → cut group order, not the
 * user's layer order.
 *
 * Run: npx tsx tests/job-mode-plan-summary.test.ts
 */
import { jobModePlanSummary } from '../src/ui/components/connection/jobModePlanSummary';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';
import type { Scene } from '../src/core/scene/Scene';
import type { LayerMode } from '../src/core/scene/Layer';

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

console.log('\n=== T1-62 jobModePlanSummary ===\n');

function buildScene(layerModes: LayerMode[]): Scene {
  let scene = createScene(400, 300, 'plan-summary-test');
  // Replace the default cut layer with the requested layer set, each
  // carrying a single visible object so it counts as "contributing."
  const layers = layerModes.map((mode, i) => createLayer(i, mode, `${mode}-${i}`));
  scene = { ...scene, layers, activeLayerId: layers[0]?.id ?? scene.activeLayerId };
  for (const layer of layers) {
    scene = addObject(scene, createRect(layer.id, 10 * (1 + layers.indexOf(layer)), 10, 20, 20));
  }
  return scene;
}

// No objects -> null (single-mode header already says "Running").
{
  const scene = createScene(400, 300, 'no-objects');
  assert(jobModePlanSummary(scene) === null, 'no objects: returns null');
}

// Single layer mode (cut only) with objects -> null.
{
  const scene = buildScene(['cut']);
  assert(jobModePlanSummary(scene) === null, 'single-mode (cut): returns null');
}

// Single mode (engrave only) -> null.
{
  const scene = buildScene(['engrave']);
  assert(jobModePlanSummary(scene) === null, 'single-mode (engrave): returns null');
}

// engrave + cut -> "Engrave → Cut" regardless of layer order.
{
  const a = jobModePlanSummary(buildScene(['engrave', 'cut']));
  assert(a === 'Engrave → Cut', 'engrave+cut order: "Engrave → Cut"');
  const b = jobModePlanSummary(buildScene(['cut', 'engrave']));
  assert(b === 'Engrave → Cut', 'cut+engrave layer order still produces "Engrave → Cut" (planner order is fixed)');
}

// score + cut -> "Score → Cut".
{
  const s = jobModePlanSummary(buildScene(['score', 'cut']));
  assert(s === 'Score → Cut', 'score+cut: "Score → Cut"');
}

// engrave + score + cut -> "Engrave → Score → Cut".
{
  const s = jobModePlanSummary(buildScene(['engrave', 'score', 'cut']));
  assert(s === 'Engrave → Score → Cut', 'engrave+score+cut: full three-step plan');
}

// engrave + score (no cut) -> "Engrave → Score".
{
  const s = jobModePlanSummary(buildScene(['engrave', 'score']));
  assert(s === 'Engrave → Score', 'engrave+score: "Engrave → Score"');
}

// Image layer maps to "Engrave" — image+cut should be "Engrave → Cut".
{
  const s = jobModePlanSummary(buildScene(['image', 'cut']));
  assert(s === 'Engrave → Cut', 'image+cut: image is labelled Engrave (planner treats them identically)');
}

// Image + engrave -> single dedup label, returns null (activeLabel says
// "Engraving" already).
{
  const s = jobModePlanSummary(buildScene(['image', 'engrave']));
  assert(s === null, 'image+engrave dedupes to single Engrave step → null (no plan summary needed)');
}

// Layer with no objects does NOT contribute. engrave+cut where the cut
// layer has no objects -> single contributor -> null.
{
  let scene = createScene(400, 300, 'cut-empty');
  const engraveLayer = createLayer(0, 'engrave', 'Engrave');
  const cutLayer = createLayer(1, 'cut', 'Cut');
  scene = { ...scene, layers: [engraveLayer, cutLayer], activeLayerId: engraveLayer.id };
  scene = addObject(scene, createRect(engraveLayer.id, 10, 10, 20, 20));
  // cutLayer intentionally has no object.
  assert(jobModePlanSummary(scene) === null, 'layer without objects does not contribute to plan summary');
}

// Hidden layer does NOT contribute (visible:false).
{
  let scene = createScene(400, 300, 'hidden-cut');
  const engraveLayer = createLayer(0, 'engrave', 'Engrave');
  const cutLayer = { ...createLayer(1, 'cut', 'Cut'), visible: false };
  scene = { ...scene, layers: [engraveLayer, cutLayer], activeLayerId: engraveLayer.id };
  scene = addObject(scene, createRect(engraveLayer.id, 10, 10, 20, 20));
  scene = addObject(scene, createRect(cutLayer.id, 30, 30, 20, 20));
  assert(jobModePlanSummary(scene) === null, 'hidden layer does not contribute (output is single-mode)');
}

// output:false layer does NOT contribute.
{
  let scene = createScene(400, 300, 'no-output-cut');
  const engraveLayer = createLayer(0, 'engrave', 'Engrave');
  const cutLayer = { ...createLayer(1, 'cut', 'Cut'), output: false as const };
  scene = { ...scene, layers: [engraveLayer, cutLayer], activeLayerId: engraveLayer.id };
  scene = addObject(scene, createRect(engraveLayer.id, 10, 10, 20, 20));
  scene = addObject(scene, createRect(cutLayer.id, 30, 30, 20, 20));
  assert(jobModePlanSummary(scene) === null, 'output:false layer does not contribute (guide layers ignored)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
