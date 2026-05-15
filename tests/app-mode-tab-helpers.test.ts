import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import { buildModeTabSelectResult } from '../src/ui/components/app/appModeTabHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

function object(id: string, layerId: string, visible = true, locked = false): SceneObject {
  return {
    id,
    type: 'path',
    name: id,
    layerId,
    parentId: null,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'path', subPaths: [] },
    visible,
    locked,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function sceneWithLayers(): Scene {
  const cut = createLayer(0, 'cut', 'Cut');
  const engraveA = createLayer(1, 'engrave', 'Engrave');
  const engraveB = createLayer(2, 'engrave', 'Engrave 2');
  return {
    ...createScene(400, 300, 'Mode helper test'),
    layers: [cut, engraveA, engraveB],
    activeLayerId: cut.id,
    objects: [
      object('cut-visible', cut.id),
      object('engrave-visible-a', engraveA.id),
      object('engrave-hidden', engraveA.id, false),
      object('engrave-locked-visible', engraveB.id, true, true),
    ],
  };
}

console.log('\n=== T2-6 Phase 3aa app mode-tab helpers ===\n');

{
  const scene = sceneWithLayers();
  const result = buildModeTabSelectResult(scene, 'engrave');
  assert(result.action === null, 'existing mode does not request a history action');
  assert(result.scene !== scene, 'inactive existing layer returns a new active-layer scene');
  assert(result.scene.activeLayerId === scene.layers[1].id, 'existing mode activates first matching layer');
  assert(result.selectionAfter.has('engrave-visible-a'), 'existing mode selects visible object on first matching layer');
  assert(result.selectionAfter.has('engrave-locked-visible'), 'existing mode preserves legacy behavior: visible locked objects are included');
  assert(!result.selectionAfter.has('engrave-hidden'), 'existing mode skips hidden objects');
  assert(!result.selectionAfter.has('cut-visible'), 'existing mode skips objects on other modes');
}

{
  const scene = sceneWithLayers();
  const result = buildModeTabSelectResult({ ...scene, activeLayerId: scene.layers[1].id }, 'engrave');
  assert(result.action === null, 'already-active existing mode still has no history action');
  assert(result.scene === result.previousScene, 'already-active mode reuses the previous scene reference');
  assert(result.selectionAfter.size === 2, 'already-active mode still derives selection for all visible mode objects');
}

{
  const scene = sceneWithLayers();
  const result = buildModeTabSelectResult(scene, 'score');
  assert(result.action === 'mode-select', 'missing mode layer requests the mode-select history action');
  assert(result.scene !== scene, 'missing mode layer creates a new scene');
  assert(result.scene.layers.length === scene.layers.length + 1, 'missing mode layer appends one layer');
  const created = result.scene.layers[result.scene.layers.length - 1];
  assert(created.settings.mode === 'score', 'created layer uses requested mode');
  assert(created.name === 'Score', 'created layer uses the friendly mode name');
  assert(created.order === 3, 'created layer order follows the max existing order');
  assert(result.scene.activeLayerId === created.id, 'created layer becomes active');
  assert(result.selectionAfter.size === 0, 'new empty mode selects no objects');
}

{
  const scene = { ...createScene(400, 300), layers: [], activeLayerId: 'missing-layer' };
  const result = buildModeTabSelectResult(scene, 'custom');
  assert(result.action === 'mode-select', 'custom missing mode creates through the history path');
  assert(result.scene.layers[0].name === 'custom', 'unknown modes fall back to the raw mode name');
  assert(result.scene.layers[0].order === 0, 'first created layer order is zero');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appModeTabHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildModeTabSelectResult'),
  'App imports and uses buildModeTabSelectResult',
);
assert(
  !appSource.includes('modeNames: Record<string, string>'),
  'App no longer carries the mode-name lookup inline',
);
assert(
  !appSource.includes('Math.max(...prev.layers.map(l => l.order))'),
  'App no longer computes new layer order inline for mode tabs',
);
assert(
  helperSource.includes('T2-6 Phase 3aa'),
  'appModeTabHelpers carries the T2-6 Phase 3aa marker',
);

console.log('Mode-tab layer creation and selection derivation are extracted from App.');
