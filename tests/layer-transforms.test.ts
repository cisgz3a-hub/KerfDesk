/**
 * T1-142: regression test for the pure layer add/remove transforms
 * extracted from LayerPanel. Pre-T1-142 these lived as
 * `handleAddLayer` / `handleRemoveLayer` useCallback bodies.
 *
 * Pinned contracts:
 *   - addSceneLayer cycles cut→engrave→score→image and adds a
 *     numeric suffix (" 2", " 3", ...) after the first 4 layers
 *   - addSceneLayer sets activeLayerId to the new layer
 *   - removeActiveSceneLayer protects against deleting the last layer
 *   - removeActiveSceneLayer cleans up orphan objects on the removed
 *     layer
 *   - removeActiveSceneLayer sets activeLayerId to the first survivor
 *
 * Run: npx tsx tests/layer-transforms.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { Layer } from '../src/core/scene/Layer';
import type { SceneObject } from '../src/core/scene/SceneObject';
import {
  addSceneLayer,
  removeActiveSceneLayer,
} from '../src/ui/components/layers/layerTransforms';

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

function makeScene(layerCount = 1, objects: SceneObject[] = []): Scene {
  const layers: Layer[] = [];
  for (let i = 0; i < layerCount; i++) {
    layers.push({ id: `l-${i}`, name: `L${i}` } as Layer);
  }
  return {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects,
    layers,
    activeLayerId: layers[0]?.id ?? '',
    metadata: { name: 't' } as never,
  } as unknown as Scene;
}

console.log('\n=== T1-142 layer transforms ===\n');

// -------- 1. addSceneLayer: starting from 1 layer (index 1 = engrave) --------
{
  const r = addSceneLayer(makeScene(1));
  assert(r.layers.length === 2, 'add 1 layer → 2 total');
  const added = r.layers[1];
  assert(added.settings.mode === 'engrave',
    'index 1 % 4 = engrave mode');
  assert(added.name === 'Engrave',
    'index 1 name = "Engrave" (no suffix)');
  assert(r.activeLayerId === added.id,
    'activeLayerId = new layer');
}

// -------- 2. addSceneLayer: index 0 = cut --------
{
  const empty: Scene = {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects: [],
    layers: [],
    activeLayerId: '',
    metadata: { name: 't' } as never,
  } as unknown as Scene;
  const r = addSceneLayer(empty);
  assert(r.layers.length === 1 && r.layers[0].settings.mode === 'cut',
    'index 0 → cut');
  assert(r.layers[0].name === 'Cut',
    'index 0 name = "Cut"');
}

// -------- 3. addSceneLayer cycle: 4 layers covers cut/engrave/score/image --------
{
  let s = makeScene(0);
  // hack: makeScene(0) leaves activeLayerId empty
  s = { ...s, layers: [] };
  s = addSceneLayer(s); // cut
  s = addSceneLayer(s); // engrave
  s = addSceneLayer(s); // score
  s = addSceneLayer(s); // image
  assert(s.layers.map((l) => l.settings.mode).join(',') === 'cut,engrave,score,image',
    '4 adds = cut, engrave, score, image');
  assert(s.layers.map((l) => l.name).join(',') === 'Cut,Engrave,Score,Image',
    'first 4 names have no suffix');
}

// -------- 4. addSceneLayer index 4 → "Cut 2" (suffix kicks in) --------
{
  let s = makeScene(4);
  s = addSceneLayer(s); // index 4
  const added = s.layers[s.layers.length - 1];
  assert(added.settings.mode === 'cut',
    'index 4 % 4 = cut mode');
  // floor(4/4 + 1) = floor(2.0) = 2
  assert(added.name === 'Cut 2',
    'index 4 name = "Cut 2" (suffix kicks in)');
}

// -------- 5. addSceneLayer index 8 → "Cut 3" --------
{
  let s = makeScene(8);
  s = addSceneLayer(s);
  const added = s.layers[s.layers.length - 1];
  // floor(8/4 + 1) = floor(3.0) = 3
  assert(added.name === 'Cut 3', 'index 8 → "Cut 3"');
}

// -------- 6. addSceneLayer doesn't mutate input --------
{
  const s = makeScene(2);
  const originalLayers = s.layers;
  addSceneLayer(s);
  assert(s.layers === originalLayers, 'input scene.layers unchanged');
}

// -------- 7. removeActiveSceneLayer: last layer protected --------
{
  const s = makeScene(1);
  const r = removeActiveSceneLayer(s);
  assert(r === s, 'last layer: returns identical reference (no-op)');
}

// -------- 8. removeActiveSceneLayer: 2 layers, remove active --------
{
  let s = makeScene(2);
  s = { ...s, activeLayerId: 'l-0' };
  const r = removeActiveSceneLayer(s);
  assert(r.layers.length === 1, '2 layers → 1 after remove');
  assert(r.layers[0].id === 'l-1', 'remaining layer is l-1');
  assert(r.activeLayerId === 'l-1', 'activeLayerId switches to survivor');
}

// -------- 9. removeActiveSceneLayer: orphan objects cleaned --------
{
  const objects: SceneObject[] = [
    { id: 'o-on-l0', layerId: 'l-0' } as SceneObject,
    { id: 'o-on-l1', layerId: 'l-1' } as SceneObject,
    { id: 'o-on-l1b', layerId: 'l-1' } as SceneObject,
  ];
  let s = makeScene(2, objects);
  s = { ...s, activeLayerId: 'l-1' };
  const r = removeActiveSceneLayer(s);
  assert(r.objects.length === 1, '3 objects → 1 after removing l-1');
  assert(r.objects[0].id === 'o-on-l0',
    'only the l-0 object survives');
}

// -------- 10. removeActiveSceneLayer: doesn't mutate input --------
{
  const s = makeScene(2);
  const originalObjects = s.objects;
  removeActiveSceneLayer({ ...s, activeLayerId: 'l-0' });
  assert(s.objects === originalObjects, 'input scene.objects unchanged');
}

// -------- 11. Source-level pin: LayerPanel delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/LayerPanel.tsx'),
    'utf-8',
  );
  assert(/from '\.\/layers\/layerTransforms'/.test(panelSrc),
    'LayerPanel imports from layers/layerTransforms');
  assert(/addSceneLayer\(scene\)/.test(panelSrc),
    'LayerPanel calls addSceneLayer(scene)');
  assert(/removeActiveSceneLayer\(scene\)/.test(panelSrc),
    'LayerPanel calls removeActiveSceneLayer(scene)');
  assert(/T1-142/.test(panelSrc),
    'LayerPanel carries T1-142 marker');
  // The pre-T1-142 inline cycling + naming block is gone.
  assert(!/const modes: LayerMode\[\] = \['cut', 'engrave', 'score', 'image'\]/.test(panelSrc),
    'inline mode-cycle array is gone from LayerPanel');
  assert(!/const names = \['Cut', 'Engrave', 'Score', 'Image'\]/.test(panelSrc),
    'inline name-cycle array is gone from LayerPanel');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/layers/layerTransforms.ts'),
    'utf-8',
  );
  assert(/T1-142/.test(helperSrc),
    'layerTransforms carries T1-142 marker');
  assert(/export function addSceneLayer/.test(helperSrc),
    'addSceneLayer is exported');
  assert(/export function removeActiveSceneLayer/.test(helperSrc),
    'removeActiveSceneLayer is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
