import { HistoryManager } from '../src/ui/history/HistoryManager';
import {
  makeCommitSceneTransaction,
  type SceneTransactionDeps,
  type HistoryEntryMetaForward,
} from '../src/ui/scene/SceneTransaction';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';

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

function setEq<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function filterValidIds(ids: ReadonlySet<string>, scene: Scene): Set<string> {
  if (ids.size === 0) return new Set();
  const sceneIds = new Set(scene.objects.map(o => o.id));
  const valid = new Set<string>();
  for (const id of ids) {
    if (sceneIds.has(id)) valid.add(id);
  }
  return valid;
}

function makeEnv() {
  const hist = new HistoryManager();
  const state = {
    scene: createScene(400, 300, 'env-init'),
    selection: new Set<string>(),
    dirty: false,
    gcodeStale: false,
    historyVersion: 0,
  };

  const deps: SceneTransactionDeps = {
    setScene: (s) => { state.scene = s; },
    history: {
      push: (s, m) => hist.push(s, m as HistoryEntryMetaForward | undefined),
      reset: (s, m) => hist.reset(s, m as HistoryEntryMetaForward | undefined),
    },
    setSelectedIds: (ids) => { state.selection = new Set(ids); },
    notifyDirty: (d) => { state.dirty = d; },
    getSelection: () => state.selection,
    invalidate: {
      compile: () => { state.gcodeStale = true; },
      frame: () => { state.historyVersion += 1; },
      preflight: () => { /* no-op */ },
    },
  };
  const commit = makeCommitSceneTransaction(deps);
  hist.push(state.scene, { action: 'init' });
  return { hist, state, commit };
}

function doUndo(env: ReturnType<typeof makeEnv>): boolean {
  const entry = env.hist.undoEntry();
  if (!entry) return false;
  const valid = filterValidIds(entry.selectionAfter, entry.scene);
  env.commit(entry.scene, { kind: 'history', direction: 'undo' }, { selectionAfter: valid });
  return true;
}

function doRedo(env: ReturnType<typeof makeEnv>): boolean {
  const entry = env.hist.redoEntry();
  if (!entry) return false;
  const valid = filterValidIds(entry.selectionAfter, entry.scene);
  env.commit(entry.scene, { kind: 'history', direction: 'redo' }, { selectionAfter: valid });
  return true;
}

console.log('\n=== T2-79 selection restore on undo/redo ===\n');

console.log('-- 1. undo paste restores pre-paste selection --');
{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0]!.id;
  const obj1 = createRect(layerId, 10, 10, 50, 50);
  const sceneWith1 = addObject(env.state.scene, obj1);
  env.commit(sceneWith1, { kind: 'edit', action: 'add-object' }, {
    selectionAfter: new Set([obj1.id]),
  });

  const newId = 'pasted-id-1';
  const newObj = { ...obj1, id: newId };
  const sceneWithPaste: Scene = { ...sceneWith1, objects: [...sceneWith1.objects, newObj] };
  env.commit(sceneWithPaste, { kind: 'edit', action: 'paste' }, {
    selectionAfter: new Set([newId]),
  });

  assert(setEq(env.state.selection, new Set([newId])), 'pre-undo: selection is the pasted ID');
  assert(doUndo(env), 'undo applied');
  assert(
    setEq(env.state.selection, new Set([obj1.id])),
    'undo paste restores pre-paste selection',
  );
  assert(env.state.scene === sceneWith1, 'undo paste reverts scene');
}

console.log('-- 2. redo paste selects pasted IDs --');
{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0]!.id;
  const obj1 = createRect(layerId, 10, 10, 50, 50);
  const sceneWith1 = addObject(env.state.scene, obj1);
  env.commit(sceneWith1, { kind: 'edit', action: 'add-object' }, {
    selectionAfter: new Set([obj1.id]),
  });
  const newId = 'pasted-id-2';
  const newObj = { ...obj1, id: newId };
  const sceneWithPaste: Scene = { ...sceneWith1, objects: [...sceneWith1.objects, newObj] };
  env.commit(sceneWithPaste, { kind: 'edit', action: 'paste' }, {
    selectionAfter: new Set([newId]),
  });
  doUndo(env);
  assert(setEq(env.state.selection, new Set([obj1.id])), 'mid: undo returns pre-paste selection');
  assert(doRedo(env), 'redo applied');
  assert(setEq(env.state.selection, new Set([newId])), 'redo paste selects pasted ID');
  assert(env.state.scene === sceneWithPaste, 'redo paste -> scene is post-paste');
}

console.log('-- 3. undo delete restores pre-delete selection --');
{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0]!.id;
  const a = createRect(layerId, 10, 10, 50, 50);
  const b = createRect(layerId, 100, 100, 50, 50);
  const sceneAB = addObject(addObject(env.state.scene, a), b);
  env.commit(sceneAB, { kind: 'edit', action: 'add-objects' }, {
    selectionAfter: new Set([a.id, b.id]),
  });
  const sceneAOnly: Scene = { ...sceneAB, objects: sceneAB.objects.filter(o => o.id !== b.id) };
  env.commit(sceneAOnly, { kind: 'edit', action: 'delete' }, { selectionAfter: new Set() });
  assert(env.state.selection.size === 0, 'post-delete: selection is empty');
  doUndo(env);
  assert(
    setEq(env.state.selection, new Set([a.id, b.id])),
    'undo delete restores pre-delete selection',
  );
}

console.log('-- 4. two-deep undo lands on each entry in turn --');
{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0]!.id;
  const a = createRect(layerId, 10, 10, 50, 50);
  const b = createRect(layerId, 100, 100, 50, 50);
  const c = createRect(layerId, 200, 200, 50, 50);
  const sceneA = addObject(env.state.scene, a);
  const sceneAB = addObject(sceneA, b);
  const sceneABC = addObject(sceneAB, c);
  env.commit(sceneA, { kind: 'edit', action: 'add' }, { selectionAfter: new Set([a.id]) });
  env.commit(sceneAB, { kind: 'edit', action: 'add' }, { selectionAfter: new Set([b.id]) });
  env.commit(sceneABC, { kind: 'edit', action: 'add' }, { selectionAfter: new Set([c.id]) });
  doUndo(env);
  assert(setEq(env.state.selection, new Set([b.id])), 'first undo selects B');
  doUndo(env);
  assert(setEq(env.state.selection, new Set([a.id])), 'second undo selects A');
}

console.log('-- 5. stale IDs in selectionAfter are filtered --');
{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0]!.id;
  const a = createRect(layerId, 10, 10, 50, 50);
  const sceneA = addObject(env.state.scene, a);
  env.hist.push(sceneA, {
    action: 'edit',
    selectionAfter: new Set([a.id, 'stale-id-that-does-not-exist']),
  });
  doUndo(env);
  assert(env.state.scene !== sceneA, 'pre-redo: cursor below the malformed entry');
  doRedo(env);
  assert(setEq(env.state.selection, new Set([a.id])), 'stale selection IDs are filtered out');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
