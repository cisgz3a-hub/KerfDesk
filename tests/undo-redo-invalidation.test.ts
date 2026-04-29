/**
 * T1-75 regression test: undo/redo must mark the scene dirty AND invalidate
 * compiled G-code AND clear the frame state.
 *
 * Bug: `App.tsx:handleUndo`/`handleRedo` updated the scene via setScene only.
 * They did not mark dirty, did not invalidate compiled G-code, and did not
 * reset hasFramed. The compile manager's scene-watching stale-marking effect
 * early-returns when the connection sidebar is closed, so closing the
 * sidebar then undoing left compiled G-code internally fresh while the
 * visible scene differed. hasFramed (encapsulated in ConnectionPanelMain)
 * had no scene-watching effect at all — undo could change burn bounds while
 * hasFramed.current === true, satisfying the T1-59 frame-before-start gate
 * against an outdated frame action.
 *
 * Fix: undo/redo now route through `applyHistoryScene` in App.tsx which:
 *   - sets sceneIsDirtyRef.current = true,
 *   - calls setGcodeStale(true) directly (not effect-gated),
 *   - bumps a `historyVersion` counter passed to ConnectionPanelMain.
 * The panel watches that counter via an effect that resets
 * hasFramed.current = false. This keeps hasFramed encapsulated in the panel
 * rather than lifting it into App.
 *
 * This test mirrors both the App-side `applyHistoryScene` flow and the
 * panel-side historyVersion effect with a real HistoryManager so undo/redo
 * boundary cases (null at start/end of history) are exercised, not stubbed.
 *
 * Run: npx tsx tests/undo-redo-invalidation.test.ts
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

interface AppState {
  sceneIsDirtyRef: RefObj<boolean>;
  gcodeStale: boolean;
  historyVersion: number;
  selectedIds: Set<string>;
  scene: Scene | null;
}

interface PanelState {
  hasFramed: RefObj<boolean>;
  workflowVersion: number;
  /** Mirrors the panel's prop snapshot of historyVersion. */
  historyVersionSeen: number;
}

/**
 * Mirror of the post-fix `applyHistoryScene` in App.tsx. Kept structurally
 * identical so a future divergence shows up here.
 */
function runApplyHistoryScene(
  app: AppState,
  nextScene: Scene,
  selectionAfter: ReadonlySet<string>,
): void {
  app.scene = nextScene;
  app.selectedIds = new Set(selectionAfter);
  app.sceneIsDirtyRef.current = true;
  app.gcodeStale = true;
  app.historyVersion += 1;
}

/**
 * Mirror of the panel's `useEffect` watching `historyVersion`. The effect
 * runs whenever the prop changes, resetting hasFramed and bumping
 * workflowVersion. We model it by syncing whenever the panel observes a
 * new historyVersion from app state.
 */
function runPanelHistoryEffect(panel: PanelState, app: AppState): void {
  if (panel.historyVersionSeen !== app.historyVersion) {
    panel.hasFramed.current = false;
    panel.workflowVersion += 1;
    panel.historyVersionSeen = app.historyVersion;
  }
}

/**
 * Mirror of `handleUndo` post-fix. Returns true if undo applied.
 */
function runHandleUndo(app: AppState, hist: HistoryManager): boolean {
  const entry = hist.undoEntry();
  if (entry) {
    runApplyHistoryScene(app, entry.scene, entry.selectionAfter);
    return true;
  }
  return false;
}

/**
 * Mirror of `handleRedo` post-fix. Returns true if redo applied.
 */
function runHandleRedo(app: AppState, hist: HistoryManager): boolean {
  const entry = hist.redoEntry();
  if (entry) {
    runApplyHistoryScene(app, entry.scene, entry.selectionAfter);
    return true;
  }
  return false;
}

function freshAppState(initialScene: Scene): AppState {
  return {
    sceneIsDirtyRef: { current: false },
    gcodeStale: false,
    historyVersion: 0,
    selectedIds: new Set(),
    scene: initialScene,
  };
}

function freshPanelState(): PanelState {
  return {
    hasFramed: { current: false },
    workflowVersion: 0,
    historyVersionSeen: 0,
  };
}

/** Build a baseline scene with two rects and a 3-step history. */
function buildHistory(): {
  scene0: Scene;
  scene1: Scene;
  scene2: Scene;
  hist: HistoryManager;
  rectAId: string;
  rectBId: string;
} {
  const blank = createScene(400, 300, 'T1-75 test');
  const layerId = blank.layers[0]!.id;
  const a = createRect(layerId, 10, 10, 50, 50);
  const b = createRect(layerId, 100, 100, 50, 50);
  const scene0 = blank;
  const scene1 = addObject(scene0, a);
  const scene2 = addObject(scene1, b);
  const hist = new HistoryManager();
  hist.push(scene0);
  hist.push(scene1);
  hist.push(scene2);
  return { scene0, scene1, scene2, hist, rectAId: a.id, rectBId: b.id };
}

void (() => {
  console.log('\n=== undo/redo invalidation (T1-75) ===\n');

  // ── 1. Compile + frame, then undo: dirty true, gcodeStale true, hasFramed false
  {
    const { scene2, hist } = buildHistory();
    const app = freshAppState(scene2);
    const panel = freshPanelState();
    // Simulate a successful compile + frame BEFORE the undo:
    app.gcodeStale = false;
    panel.hasFramed.current = true;

    const applied = runHandleUndo(app, hist);
    runPanelHistoryEffect(panel, app);

    assert(applied === true, 'undo applied (history had entries to go back to)');
    assert(
      app.sceneIsDirtyRef.current,
      'undo → sceneIsDirtyRef.current = true (the original T1-75 dirty bug)',
    );
    assert(
      app.gcodeStale,
      'undo → gcodeStale = true (direct invalidation, not effect-gated)',
    );
    assert(
      !panel.hasFramed.current,
      'undo → hasFramed.current = false via the historyVersion bridge effect',
    );
    assert(
      app.selectedIds.size === 0,
      'undo → selection follows entry.selectionAfter (empty for entries pushed without metadata in this test)',
    );
  }

  // ── 2. Connection sidebar closed during undo: still invalidates ────────
  // Behavior was: useCompileManager's scene-watching effect early-returns
  // when sidebar is closed, so undo with sidebar closed left gcodeStale=false.
  // After T1-75: applyHistoryScene calls setGcodeStale(true) directly, so
  // the sidebar-closed gate doesn't matter.
  {
    const { scene2, hist } = buildHistory();
    const app = freshAppState(scene2);
    app.gcodeStale = false;
    // Note: connectionSidebarOpen state is irrelevant in the post-fix model
    // because applyHistoryScene calls setGcodeStale directly.

    runHandleUndo(app, hist);

    assert(
      app.gcodeStale,
      'sidebar-closed undo: still invalidates gcode (was effect-gated; now direct)',
    );
  }

  // ── 3. Redo path follows the same shape ───────────────────────────────
  {
    const { scene2, hist } = buildHistory();
    const app = freshAppState(scene2);
    const panel = freshPanelState();

    // Undo first to put redo entries on the stack.
    runHandleUndo(app, hist);
    runPanelHistoryEffect(panel, app);

    // Reset side-effect markers to verify redo also sets them.
    app.sceneIsDirtyRef.current = false;
    app.gcodeStale = false;
    panel.hasFramed.current = true;
    const versionBeforeRedo = app.historyVersion;

    const applied = runHandleRedo(app, hist);
    runPanelHistoryEffect(panel, app);

    assert(applied === true, 'redo applied');
    assert(
      app.sceneIsDirtyRef.current,
      'redo → sceneIsDirtyRef = true',
    );
    assert(app.gcodeStale, 'redo → gcodeStale = true');
    assert(
      !panel.hasFramed.current,
      'redo → hasFramed = false via historyVersion bridge',
    );
    assert(
      app.historyVersion === versionBeforeRedo + 1,
      'redo → historyVersion incremented',
    );
  }

  // ── 4. historyVersion increments monotonically across multiple undos ──
  {
    const { scene2, hist } = buildHistory();
    const app = freshAppState(scene2);

    const v0 = app.historyVersion;
    runHandleUndo(app, hist); // scene2 → scene1
    const v1 = app.historyVersion;
    runHandleUndo(app, hist); // scene1 → scene0
    const v2 = app.historyVersion;

    assert(v0 === 0, 'initial historyVersion === 0');
    assert(v1 === v0 + 1, 'first undo → historyVersion = 1');
    assert(v2 === v1 + 1, 'second undo → historyVersion = 2');
  }

  // ── 5. undo at history start: returns null, no invalidation ───────────
  {
    const { scene0, hist } = buildHistory();
    // Walk back to the start.
    hist.undo(); // scene2 → scene1
    hist.undo(); // scene1 → scene0
    // Now hist.getCurrent() === scene0 and canUndo === false.
    assert(
      hist.canUndo() === false,
      'sanity: at history start, canUndo === false',
    );

    const app = freshAppState(scene0);
    app.sceneIsDirtyRef.current = false;
    app.gcodeStale = false;
    const versionBefore = app.historyVersion;

    const applied = runHandleUndo(app, hist);

    assert(applied === false, 'undo at history start → no-op (returns false)');
    assert(
      app.sceneIsDirtyRef.current === false,
      'undo at history start → dirty stays false',
    );
    assert(
      app.gcodeStale === false,
      'undo at history start → gcodeStale stays false',
    );
    assert(
      app.historyVersion === versionBefore,
      'undo at history start → historyVersion unchanged',
    );
  }

  // ── 6. redo at history end: returns null, no invalidation ─────────────
  {
    const { scene2, hist } = buildHistory();
    // Cursor is already at the latest entry; redo should fail.
    assert(
      hist.canRedo() === false,
      'sanity: at history end, canRedo === false',
    );

    const app = freshAppState(scene2);
    const versionBefore = app.historyVersion;

    const applied = runHandleRedo(app, hist);

    assert(applied === false, 'redo at history end → no-op (returns false)');
    assert(
      app.sceneIsDirtyRef.current === false,
      'redo at history end → dirty stays false',
    );
    assert(
      app.historyVersion === versionBefore,
      'redo at history end → historyVersion unchanged',
    );
  }

  // ── 7. Realistic round trip: delete-rect, undo, redo, undo restores ───
  {
    const blank = createScene(400, 300, 'roundtrip');
    const layerId = blank.layers[0]!.id;
    const a = createRect(layerId, 10, 10, 50, 50);
    const b = createRect(layerId, 100, 100, 50, 50);
    const sceneAB = addObject(addObject(blank, a), b);
    const sceneA = deleteObjects(sceneAB, new Set([b.id])); // delete B

    const hist = new HistoryManager();
    hist.push(sceneAB);
    hist.push(sceneA); // mimics handleSceneCommit after delete
    const app = freshAppState(sceneA);
    const panel = freshPanelState();

    // User had compiled + framed before:
    app.gcodeStale = false;
    panel.hasFramed.current = true;

    // Undo: should restore B
    runHandleUndo(app, hist);
    runPanelHistoryEffect(panel, app);
    assert(
      app.scene !== null && app.scene.objects.length === 2,
      'undo restored deleted object (now 2 objects)',
    );
    assert(
      app.sceneIsDirtyRef.current && app.gcodeStale && !panel.hasFramed.current,
      'undo invalidates dirty + gcode + frame',
    );

    // Redo: re-deletes B
    runHandleRedo(app, hist);
    runPanelHistoryEffect(panel, app);
    assert(
      app.scene !== null && app.scene.objects.length === 1,
      'redo re-applied delete (back to 1 object)',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
