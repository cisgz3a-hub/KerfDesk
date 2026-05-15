import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { buildActivateLayerCommit } from '../src/ui/components/app/appActivateLayerHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

function sceneWithLayers(): Scene {
  const cut = createLayer(0, 'cut', 'Cut');
  const engrave = createLayer(1, 'engrave', 'Engrave');
  return {
    ...createScene(400, 300, 'Activate layer helper test'),
    layers: [cut, engrave],
    activeLayerId: cut.id,
  };
}

console.log('\n=== T2-6 Phase 3ac app activate-layer helpers ===\n');

{
  const scene = sceneWithLayers();
  const result = buildActivateLayerCommit(scene, scene.activeLayerId);
  assert(result === null, 'activating the already-active layer produces no commit');
}

{
  const scene = sceneWithLayers();
  const targetLayerId = scene.layers[1].id;
  const result = buildActivateLayerCommit(scene, targetLayerId);
  assert(result != null, 'activating a different layer produces a commit');
  assert(result.action === 'activate-layer', 'activation helper uses activate-layer action');
  assert(result.scene !== scene, 'activation helper returns a new scene');
  assert(result.scene.activeLayerId === targetLayerId, 'activation helper updates activeLayerId');
  assert(result.scene.layers === scene.layers, 'activation helper preserves layer array reference');
  assert(result.scene.objects === scene.objects, 'activation helper preserves object array reference');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appActivateLayerHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildActivateLayerCommit'),
  'App imports and uses buildActivateLayerCommit',
);
assert(
  !appSource.includes('if (prev.activeLayerId === layerId) return;'),
  'App no longer carries the active-layer no-op check inline',
);
assert(
  !appSource.includes("handleSceneCommit({ ...prev, activeLayerId: layerId }, 'activate-layer')"),
  'App no longer builds activate-layer scenes inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ac'),
  'appActivateLayerHelpers carries the T2-6 Phase 3ac marker',
);

console.log('Active-layer scene transaction building is extracted from App.');
