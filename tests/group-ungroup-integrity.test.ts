/**
 * T3-79: explicit group/ungroup commands and parent graph integrity.
 *
 * Run: npx tsx tests/group-ungroup-integrity.test.ts
 */
import { readFileSync } from 'node:fs';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';
import {
  groupObjects,
  remapClonedParentIds,
  repairParentGraph,
  ungroupObjects,
  validateParentGraph,
} from '../src/core/scene/SceneOps';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

function withId<T extends SceneObject>(obj: T, id: string): T {
  (obj as { id: string }).id = id;
  return obj;
}

function baseScene(ids: string[]): Scene {
  const scene = createScene(400, 300, 'T3-79 groups');
  const layerId = scene.layers[0].id;
  scene.objects = ids.map((id, index) =>
    withId(createRect(layerId, index * 10, 0, 5, 5, id), id));
  return scene;
}

function byId(scene: Scene, id: string): SceneObject {
  const obj = scene.objects.find(o => o.id === id);
  if (!obj) throw new Error(`Missing object ${id}`);
  return obj;
}

console.log('\n=== T3-79 group/ungroup integrity ===\n');

{
  const scene = baseScene(['a', 'b', 'c']);
  const grouped = groupObjects(scene, new Set(['a', 'b', 'c']), { groupId: 'group-1' });

  assert(grouped !== scene, 'groupObjects returns a new scene when grouping 3 objects');
  assert(grouped.objects.some(o => o.id === 'group-1' && o.type === 'group'), 'group object is created');
  assert(['a', 'b', 'c'].every(id => byId(grouped, id).parentId === 'group-1'),
    'grouped children point at the group object');
  assert(validateParentGraph(grouped).length === 0, 'grouped scene has a valid parent graph');
}

{
  const scene = baseScene(['a', 'b', 'c']);
  const grouped = groupObjects(scene, new Set(['a', 'b', 'c']), { groupId: 'group-1' });
  const ungrouped = ungroupObjects(grouped, new Set(['group-1']));

  assert(!ungrouped.objects.some(o => o.id === 'group-1'), 'ungroup removes the group object');
  assert(['a', 'b', 'c'].every(id => byId(ungrouped, id).parentId === null),
    'ungroup clears child parent ids');
  assert(validateParentGraph(ungrouped).length === 0, 'ungrouped scene has a valid parent graph');
}

{
  const scene = baseScene(['a', 'b', 'c']);
  const groupedA = groupObjects(scene, new Set(['a', 'b']), { groupId: 'group-a' });
  const groupedB = groupObjects(groupedA, new Set(['group-a', 'c']), { groupId: 'group-b' });
  const ungroupedB = ungroupObjects(groupedB, new Set(['group-b']));

  assert(byId(groupedB, 'group-a').parentId === 'group-b', 'nested group can be parented by a new group');
  assert(byId(ungroupedB, 'group-a').parentId === null, 'ungrouping parent group preserves nested group object');
  assert(byId(ungroupedB, 'c').parentId === null, 'ungrouping parent group reparents child to outer parent');
  assert(validateParentGraph(ungroupedB).length === 0, 'nested ungroup has no orphan parent links');
}

{
  const scene = baseScene(['parent', 'child']);
  const badMissing = {
    ...scene,
    objects: scene.objects.map(o => o.id === 'child' ? { ...o, parentId: 'missing-parent' } : o),
  };
  assert(validateParentGraph(badMissing).some(v => v.kind === 'missing-parent' && v.objectId === 'child'),
    'validator reports missing parent ids');

  const badNonGroup = {
    ...scene,
    objects: scene.objects.map(o => o.id === 'child' ? { ...o, parentId: 'parent' } : o),
  };
  assert(validateParentGraph(badNonGroup).some(v => v.kind === 'parent-not-group' && v.parentId === 'parent'),
    'validator reports non-group parents');

  const repaired = repairParentGraph(badNonGroup).scene;
  assert(byId(repaired, 'child').parentId === null, 'repair clears invalid non-group parent id');
  assert(validateParentGraph(repaired).length === 0, 'repair returns a valid parent graph');
}

{
  const scene = baseScene(['a', 'b', 'c']);
  const groupedA = groupObjects(scene, new Set(['a', 'b']), { groupId: 'group-a' });
  const groupedB = groupObjects(groupedA, new Set(['group-a', 'c']), { groupId: 'group-b' });
  const cyclic = {
    ...groupedB,
    objects: groupedB.objects.map(o =>
      o.id === 'group-b' ? { ...o, parentId: 'group-a' } : o),
  };

  assert(validateParentGraph(cyclic).some(v => v.kind === 'parent-cycle'),
    'validator reports parent cycles');
  assert(validateParentGraph(repairParentGraph(cyclic).scene).length === 0,
    'repair breaks parent cycles');
}

{
  const scene = baseScene(['a', 'b']);
  const grouped = groupObjects(scene, new Set(['a', 'b']), { groupId: 'group-1' });
  const clones = [
    { ...byId(grouped, 'group-1'), id: 'group-copy' },
    { ...byId(grouped, 'a'), id: 'a-copy' },
  ];
  const remapped = remapClonedParentIds(clones, new Map([
    ['group-1', 'group-copy'],
    ['a', 'a-copy'],
  ]));

  assert(remapped.find(o => o.id === 'a-copy')?.parentId === 'group-copy',
    'cloned child points at cloned group when the group was copied too');

  const childOnly = remapClonedParentIds([{ ...byId(grouped, 'a'), id: 'a-copy' }], new Map([
    ['a', 'a-copy'],
  ]));
  assert(childOnly[0].parentId === null, 'cloned child is ungrouped when parent group was not copied');
}

{
  const clonePathSources = [
    'src/ui/hooks/useClipboard.ts',
    'src/ui/hooks/useQuickActionHandlers.ts',
    'src/ui/hooks/useGeneratorHandlers.ts',
  ].map(path => readFileSync(path, 'utf8')).join('\n');

  assert(!clonePathSources.includes('parentIdMap'), 'clone paths no longer create synthetic parent ids');
  assert((clonePathSources.match(/remapClonedParentIds/g) ?? []).length >= 3,
    'paste, quick duplicate, and array clone use parent graph remapping');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
