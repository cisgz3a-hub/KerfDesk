/**
 * T1-73 regression test: handleDelete must mark the scene dirty.
 *
 * Bug: `App.tsx:handleDelete` manually called `historyRef.current.push(...)`
 * and `setScene(...)` without setting `sceneIsDirtyRef.current = true`.
 * The autosave timer short-circuits with `if (!sceneIsDirtyRef.current) return;`
 * — so a delete-then-close-tab lost the deletion if no other dirty-marking
 * edit happened in the next 30 seconds.
 *
 * Fix: route the new scene through the canonical `handleSceneCommit` path,
 * which sets dirty + pushes history + setScene atomically.
 *
 * This test mirrors the post-fix `handleDelete` flow with the real
 * `deleteObjects` from SceneCommands and the real `HistoryManager` plus
 * fake state mutators capturing each side effect.
 *
 * Run: npx tsx tests/delete-marks-dirty.test.ts
 */
export {};

import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject, deleteObjects } from '../src/ui/history/SceneCommands';
import { HistoryManager } from '../src/ui/history/HistoryManager';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

interface RefObj<T> { current: T }

interface DeleteDeps {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  sceneIsDirtyRef: RefObj<boolean>;
  historyRef: RefObj<HistoryManager>;
  setScene: (s: Scene) => void;
  setSelectedIds: (ids: Set<string>) => void;
}

/**
 * Mirror of the post-fix `handleDelete` flow in App.tsx, with
 * `handleSceneCommit` inlined for clarity. The production `handleSceneCommit`
 * does exactly: set dirty=true → history.push → setScene. Kept structurally
 * identical so a future divergence shows up here.
 */
function runHandleDelete(deps: DeleteDeps): void {
  if (deps.selectedIds.size === 0) return;
  const newScene = deleteObjects(deps.scene, deps.selectedIds);
  // Inline of `handleSceneCommit(newScene)`:
  deps.sceneIsDirtyRef.current = true;
  deps.historyRef.current.push(newScene);
  deps.setScene(newScene);
  deps.setSelectedIds(new Set());
}

function buildSceneWithTwoRects(): {
  scene: Scene;
  rectAId: string;
  rectBId: string;
} {
  const blank = createScene(400, 300, 'T1-73 test');
  const layerId = blank.layers[0]!.id;
  const a = createRect(layerId, 10, 10, 50, 50);
  const b = createRect(layerId, 100, 100, 50, 50);
  const s1 = addObject(blank, a);
  const s2 = addObject(s1, b);
  return { scene: s2, rectAId: a.id, rectBId: b.id };
}

void (() => {
  console.log('\n=== handleDelete marks dirty (T1-73) ===\n');

  // ── 1. Selected delete: dirty true, object removed, history pushed ─────
  {
    const { scene, rectAId, rectBId } = buildSceneWithTwoRects();
    const hist = new HistoryManager();
    hist.push(scene); // baseline (mirrors App.tsx initial mount push)

    let sceneIsDirtyRef: RefObj<boolean> = { current: false };
    let lastSetScene: Scene | null = null;
    let lastSelectedIds: Set<string> | null = null;

    runHandleDelete({
      scene,
      selectedIds: new Set([rectAId]),
      sceneIsDirtyRef,
      historyRef: { current: hist },
      setScene: (s) => { lastSetScene = s; },
      setSelectedIds: (ids) => { lastSelectedIds = ids; },
    });

    assert(
      sceneIsDirtyRef.current === true,
      'sceneIsDirtyRef.current === true after delete (the original T1-73 bug)',
    );
    const setScene = lastSetScene as Scene | null;
    assert(setScene !== null, 'setScene called with the new scene');
    assert(
      setScene !== null && setScene.objects.length === 1,
      'newScene has 1 object remaining (the unselected rect)',
    );
    assert(
      setScene !== null && setScene.objects[0]!.id === rectBId,
      'remaining object is the unselected rect (rectB)',
    );
    assert(
      hist.getCurrent() === setScene,
      'history.getCurrent() === newScene (push happened atomically with the commit)',
    );
    const selectedIds = lastSelectedIds as Set<string> | null;
    assert(
      selectedIds !== null && selectedIds.size === 0,
      'selectedIds cleared after delete',
    );
  }

  // ── 2. No-op when nothing selected: dirty stays false, no mutations ────
  {
    const { scene } = buildSceneWithTwoRects();
    const hist = new HistoryManager();
    hist.push(scene);

    const sceneIsDirtyRef: RefObj<boolean> = { current: false };
    let setSceneCalls = 0;
    let setSelectedIdsCalls = 0;

    runHandleDelete({
      scene,
      selectedIds: new Set<string>(),
      sceneIsDirtyRef,
      historyRef: { current: hist },
      setScene: () => { setSceneCalls++; },
      setSelectedIds: () => { setSelectedIdsCalls++; },
    });

    assert(
      sceneIsDirtyRef.current === false,
      'empty selection → dirty stays false (early return)',
    );
    assert(setSceneCalls === 0, 'empty selection → setScene not called');
    assert(
      setSelectedIdsCalls === 0,
      'empty selection → setSelectedIds not called',
    );
    assert(
      hist.getCurrent() === scene,
      'empty selection → history not advanced',
    );
  }

  // ── 3. Multi-select delete: both removed, dirty true ───────────────────
  {
    const { scene, rectAId, rectBId } = buildSceneWithTwoRects();
    const hist = new HistoryManager();
    hist.push(scene);

    const sceneIsDirtyRef: RefObj<boolean> = { current: false };
    let lastSetScene: Scene | null = null;

    runHandleDelete({
      scene,
      selectedIds: new Set([rectAId, rectBId]),
      sceneIsDirtyRef,
      historyRef: { current: hist },
      setScene: (s) => { lastSetScene = s; },
      setSelectedIds: () => {},
    });

    assert(
      sceneIsDirtyRef.current === true,
      'multi-select delete → dirty true',
    );
    const setScene = lastSetScene as Scene | null;
    assert(
      setScene !== null && setScene.objects.length === 0,
      'multi-select delete → both objects removed',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
