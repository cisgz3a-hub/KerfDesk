import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import type { HistoryEntry } from '../src/ui/history/HistoryManager';
import { buildHistoryNavigationCommit } from '../src/ui/components/app/appHistoryNavigationHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

function sceneWithObjects(ids: readonly string[]): Scene {
  const layer = createLayer(0, 'cut', 'Cut');
  const objects = ids.map((id, index) => ({
    ...createRect(layer.id, index * 10, index * 10, 5, 5, id),
    id,
  }));
  return {
    ...createScene(400, 300, 'History helper test'),
    layers: [layer],
    activeLayerId: layer.id,
    objects,
  };
}

function entry(scene: Scene, selectionAfter: ReadonlySet<string>): HistoryEntry {
  return {
    scene,
    action: 'test',
    timestamp: 1,
    selectionBefore: new Set(),
    selectionAfter,
  };
}

console.log('\n=== T2-6 Phase 3ag app history navigation helpers ===\n');

{
  const scene = sceneWithObjects(['keep']);
  const result = buildHistoryNavigationCommit(entry(scene, new Set(['keep', 'stale'])), 'undo');
  assert(result.scene === scene, 'history helper preserves target scene reference');
  assert(result.direction === 'undo', 'history helper preserves undo direction');
  assert(result.selectionAfter.has('keep'), 'history helper preserves valid selection id');
  assert(!result.selectionAfter.has('stale'), 'history helper filters stale selection id');
}

{
  const scene = sceneWithObjects(['redo-target']);
  const originalSelection = new Set(['redo-target']);
  const result = buildHistoryNavigationCommit(entry(scene, originalSelection), 'redo');
  assert(result.direction === 'redo', 'history helper preserves redo direction');
  assert(result.selectionAfter !== originalSelection, 'history helper returns a fresh selection set');
  assert(result.selectionAfter.has('redo-target'), 'history helper keeps redo target selected');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appHistoryNavigationHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildHistoryNavigationCommit'),
  'App imports and uses buildHistoryNavigationCommit',
);
assert(
  !appSource.includes('filterValidIds(entry.selectionAfter, entry.scene)'),
  'App no longer filters history entry selection inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ag'),
  'appHistoryNavigationHelpers carries the T2-6 Phase 3ag marker',
);

console.log('History navigation scene/selection restoration is extracted from App.');
