import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScene, type Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import { buildDeleteSelectionCommit } from '../src/ui/components/app/appDeleteSelectionHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

function object(id: string, layerId: string): SceneObject {
  return {
    id,
    type: 'rect',
    name: id,
    layerId,
    parentId: null,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'rect', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function sceneWithObjects(): Scene {
  const scene = createScene(400, 300, 'Delete helper test');
  const layerId = scene.layers[0].id;
  return {
    ...scene,
    objects: [
      object('keep', layerId),
      object('delete-a', layerId),
      object('delete-b', layerId),
    ],
  };
}

console.log('\n=== T2-6 Phase 3ab app delete-selection helpers ===\n');

{
  const scene = sceneWithObjects();
  const result = buildDeleteSelectionCommit(scene, new Set());
  assert(result === null, 'empty selection produces no delete commit');
}

{
  const scene = sceneWithObjects();
  const result = buildDeleteSelectionCommit(scene, new Set(['delete-a', 'delete-b']));
  assert(result != null, 'selected objects produce a delete commit');
  assert(result.action === 'delete', 'delete helper uses the delete action');
  assert(result.selectionAfter.size === 0, 'delete helper clears selection atomically');
  assert(result.scene.objects.length === 1, 'selected objects are removed');
  assert(result.scene.objects[0].id === 'keep', 'unselected object remains');
}

{
  const scene = sceneWithObjects();
  const result = buildDeleteSelectionCommit(scene, new Set(['missing']));
  assert(result != null, 'non-empty stale selection preserves legacy delete-commit path');
  assert(result.scene.objects.length === scene.objects.length, 'stale selected id removes nothing');
  assert(result.selectionAfter.size === 0, 'stale selected id still clears selection');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appDeleteSelectionHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildDeleteSelectionCommit'),
  'App imports and uses buildDeleteSelectionCommit',
);
assert(
  !appSource.includes("import { deleteObjects } from '../../core/scene/SceneOps'"),
  'App no longer imports deleteObjects directly',
);
assert(
  !appSource.includes('const newScene = deleteObjects(scene, selectedIds)'),
  'App no longer builds delete scenes inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ab'),
  'appDeleteSelectionHelpers carries the T2-6 Phase 3ab marker',
);

console.log('Delete-selection scene transaction building is extracted from App.');
