import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { resolveMaterialSuggestionRequest } from '../src/ui/components/app/appMaterialSuggestionHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

function sceneWithMaterial(): Scene {
  const cut = createLayer(0, 'cut', 'Cut');
  const engrave = createLayer(1, 'engrave', 'Engrave');
  return {
    ...createScene(400, 300, 'Material suggestion helper test'),
    layers: [cut, engrave],
    activeLayerId: engrave.id,
    material: {
      type: 'wood',
      name: '3mm Birch Plywood',
      width: 200,
      height: 150,
      x: 0,
      y: 0,
      thickness: 3,
      color: '#caa56a',
    },
    machine: {
      name: 'Falcon A1 Pro',
      watts: '10W',
      type: 'diode',
    },
  };
}

console.log('\n=== T2-6 Phase 3ah app material suggestion helpers ===\n');

{
  const result = resolveMaterialSuggestionRequest(sceneWithMaterial());
  assert(result !== null, 'material + active layer produce a suggestion request');
  assert(result.materialName === '3mm Birch Plywood', 'request carries material name');
  assert(result.machineType === 'diode', 'request carries machine type');
  assert(result.layerMode === 'engrave', 'request carries active layer mode');
}

{
  const scene = { ...sceneWithMaterial(), machine: undefined };
  const result = resolveMaterialSuggestionRequest(scene);
  assert(result?.machineType === 'diode', 'missing machine type defaults to diode');
}

{
  const scene = { ...sceneWithMaterial(), material: null };
  assert(resolveMaterialSuggestionRequest(scene) === null, 'missing material produces no request');
}

{
  const scene = { ...sceneWithMaterial(), activeLayerId: 'missing-layer' };
  assert(resolveMaterialSuggestionRequest(scene) === null, 'missing active layer produces no request');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appMaterialSuggestionHelpers.ts'), 'utf8');

assert(
  appSource.includes('resolveMaterialSuggestionRequest'),
  'App imports and uses resolveMaterialSuggestionRequest',
);
assert(
  !appSource.includes('activeLayerModeForSuggestion'),
  'App no longer carries the material-suggestion dependency shim inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ah'),
  'appMaterialSuggestionHelpers carries the T2-6 Phase 3ah marker',
);

console.log('Material suggestion request derivation is extracted from App.');
