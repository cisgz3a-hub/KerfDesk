/**
 * T1-74 regression test: text property edits in the properties sidebar must
 * commit to history and mark scene dirty.
 *
 * Bug: `PropertiesPanel.tsx:patchTextGeometry` ended with
 *   `(onSceneChange ?? onSceneCommit)(newScene);`
 * `onSceneChange` was always provided by the parent, so every text-property
 * edit (font, fontSize, bold, italic, textAlign, letterSpacing, lineSpacing,
 * wordSpacing) routed through `App.handleSceneChange` which only does
 * `setScene` — no history push, no dirty flag. Two simultaneous defects:
 *   (1) Coverage gap: font, bold, italic, etc. were not undoable.
 *   (2) Data-loss risk: dirty wasn't set, so autosave could skip the change.
 *
 * Fix: `patchTextGeometry` now calls `onSceneCommit(newScene)` directly. The
 * canonical commit path (in App.tsx:handleSceneCommit) sets dirty + pushes
 * history + setScene atomically.
 *
 * This test mirrors the post-fix flow with `onSceneCommit` inlined — set
 * dirty=true, push history, setScene — exactly what production does. Uses
 * the real HistoryManager so undo/restore semantics are verified end-to-end.
 *
 * T2-80 closed the slider sub-case: letter/line/word spacing sliders now
 * use a preview/commit split. onChange → previewTextGeometry (no history,
 * no dirty flag, just live render). onPointerUp/onBlur →
 * patchTextGeometry (one history entry, one dirty flip per drag). This
 * test mirrors both functions and verifies the new contract.
 *
 * Run: npx tsx tests/text-property-edits-undoable.test.ts
 */
export {};

import { createScene, type Scene } from '../src/core/scene/Scene';
import { type SceneObject, type TextGeometry } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';
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

interface PatchDeps {
  scene: Scene;
  obj: SceneObject;
  sceneIsDirtyRef: RefObj<boolean>;
  historyRef: RefObj<HistoryManager>;
  setScene: (s: Scene) => void;
}

/**
 * Mirror of the post-fix `patchTextGeometry` in PropertiesPanel.tsx, with
 * `onSceneCommit` inlined to its canonical body (`handleSceneCommit` in
 * App.tsx — set dirty, push history, setScene). Kept structurally identical
 * to production so a future divergence shows up here.
 */
function runPatchTextGeometry(
  deps: PatchDeps,
  updates: Partial<TextGeometry>,
): Scene | null {
  if (deps.obj.geometry.type !== 'text') return null;
  const prev = deps.obj.geometry;
  const newGeom: TextGeometry = { ...prev, ...updates, type: 'text' };
  const newScene: Scene = {
    ...deps.scene,
    objects: deps.scene.objects.map(o =>
      o.id === deps.obj.id
        ? { ...o, geometry: newGeom, _bounds: null, _worldTransform: null }
        : o,
    ),
  };
  // Inline of `onSceneCommit(newScene)` (App.tsx:handleSceneCommit):
  deps.sceneIsDirtyRef.current = true;
  deps.historyRef.current.push(newScene);
  deps.setScene(newScene);
  return newScene;
}

/**
 * T2-80: mirror of the post-T2-80 `previewTextGeometry` in
 * PropertiesPanel.tsx. Same shape as runPatchTextGeometry but inlines
 * the preview path (App.tsx:handleSceneChange = setScene only) instead
 * of the commit path. Crucially: does NOT set dirty, does NOT push
 * history. The matching commit at end-of-drag goes through
 * runPatchTextGeometry.
 */
function runPreviewTextGeometry(
  deps: PatchDeps,
  updates: Partial<TextGeometry>,
): Scene | null {
  if (deps.obj.geometry.type !== 'text') return null;
  const prev = deps.obj.geometry;
  const newGeom: TextGeometry = { ...prev, ...updates, type: 'text' };
  const newScene: Scene = {
    ...deps.scene,
    objects: deps.scene.objects.map(o =>
      o.id === deps.obj.id
        ? { ...o, geometry: newGeom, _bounds: null, _worldTransform: null }
        : o,
    ),
  };
  // Inline of `onSceneChange(newScene)` (App.tsx:handleSceneChange):
  // setScene only — no dirty flip, no history push. Production has a
  // fallback to onSceneCommit if onSceneChange isn't wired; the test
  // assumes the modern host (always wired) which is the production
  // configuration.
  deps.setScene(newScene);
  return newScene;
}

/**
 * Build a SceneObject of type 'text' inline. The codebase has no
 * createText() factory; we follow the createRect template.
 */
function makeTextObject(layerId: string, text: string, id: string): SceneObject {
  return {
    id,
    type: 'text',
    name: text.slice(0, 20),
    layerId,
    parentId: null,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: {
      type: 'text',
      text,
      fontSize: 10,
      fontFamily: 'Arial',
    } as TextGeometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function makeSceneWithText(text: string): {
  scene: Scene;
  textId: string;
} {
  const blank = createScene(400, 300, 'T1-74 test');
  const layerId = blank.layers[0]!.id;
  const textObj = makeTextObject(layerId, text, 'text-1');
  const scene = addObject(blank, textObj);
  return { scene, textId: textObj.id };
}

void (() => {
  console.log('\n=== text property edits undoable (T1-74) ===\n');

  // ── 1. Font change: dirty=true + history entry + new font in scene ────
  {
    const { scene, textId } = makeSceneWithText('Hello');
    const hist = new HistoryManager();
    hist.push(scene); // baseline
    const baselineCursor = hist.cursor;

    const sceneIsDirtyRef: RefObj<boolean> = { current: false };
    let lastSetScene: Scene | null = null;

    const obj = scene.objects.find(o => o.id === textId)!;
    runPatchTextGeometry(
      {
        scene,
        obj,
        sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: (s) => { lastSetScene = s; },
      },
      { fontFamily: 'Inter' },
    );

    assert(
      sceneIsDirtyRef.current === true,
      'fontFamily change → dirty=true (the original T1-74 bug)',
    );
    assert(
      hist.cursor === baselineCursor + 1,
      'fontFamily change → history advanced exactly once',
    );
    const setScene = lastSetScene as Scene | null;
    assert(setScene !== null, 'setScene called with the new scene');
    const updatedObj = setScene!.objects.find(o => o.id === textId);
    assert(
      updatedObj !== undefined && (updatedObj.geometry as TextGeometry).fontFamily === 'Inter',
      'newScene has fontFamily="Inter"',
    );
  }

  // ── 2. Bold toggle: dirty=true + history entry per click ──────────────
  {
    const { scene, textId } = makeSceneWithText('Hello');
    const hist = new HistoryManager();
    hist.push(scene);

    const sceneIsDirtyRef: RefObj<boolean> = { current: false };

    const obj1 = scene.objects.find(o => o.id === textId)!;
    const afterBold = runPatchTextGeometry(
      {
        scene,
        obj: obj1,
        sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: () => {},
      },
      { bold: true },
    );

    assert(sceneIsDirtyRef.current === true, 'bold toggle → dirty=true');
    const obj2 = afterBold!.objects.find(o => o.id === textId)!;
    assert(
      (obj2.geometry as TextGeometry).bold === true,
      'bold=true after first toggle',
    );

    // Second click toggles back. Dirty is already true from the first
    // toggle and stays true; the meaningful proof for the second toggle is
    // a fresh history entry.
    const baselineCursor = hist.cursor;
    runPatchTextGeometry(
      {
        scene: afterBold!,
        obj: obj2,
        sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: () => {},
      },
      { bold: false },
    );
    assert(
      hist.cursor === baselineCursor + 1,
      'second bold toggle → history advanced again (one entry per atomic toggle)',
    );
  }

  // ── 3. Italic toggle: same shape, dirty=true + history entry ──────────
  {
    const { scene, textId } = makeSceneWithText('Hi');
    const hist = new HistoryManager();
    hist.push(scene);
    const sceneIsDirtyRef: RefObj<boolean> = { current: false };

    const obj = scene.objects.find(o => o.id === textId)!;
    const after = runPatchTextGeometry(
      {
        scene, obj, sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: () => {},
      },
      { italic: true },
    );
    assert(sceneIsDirtyRef.current === true, 'italic toggle → dirty=true');
    assert(
      (after!.objects.find(o => o.id === textId)!.geometry as TextGeometry).italic === true,
      'italic=true after toggle',
    );
  }

  // ── 4. Letter spacing slider drag: ONE history entry total (T2-80) ────
  // Before T2-80, sliders called patchTextGeometry on every onChange tick
  // (one history entry per tick during a drag). T2-80 split this into
  // previewTextGeometry on onChange (no history) and patchTextGeometry on
  // onPointerUp/onBlur (one history entry at end of drag).
  {
    const { scene, textId } = makeSceneWithText('Slide');
    const hist = new HistoryManager();
    hist.push(scene);
    const sceneIsDirtyRef: RefObj<boolean> = { current: false };

    let current: Scene = scene;
    const startCursor = hist.cursor;

    // Simulate three preview ticks (drag in progress: 5, 10, 15) followed
    // by one commit (end of drag at 15).
    for (const v of [5, 10, 15]) {
      const obj = current.objects.find(o => o.id === textId)!;
      const after = runPreviewTextGeometry(
        {
          scene: current, obj, sceneIsDirtyRef,
          historyRef: { current: hist },
          setScene: () => {},
        },
        { letterSpacing: v },
      );
      current = after!;
    }

    assert(
      hist.cursor === startCursor,
      'preview ticks: zero history entries during drag (T2-80 coalescing)',
    );
    assert(
      sceneIsDirtyRef.current === false,
      'preview ticks: dirty NOT set (preview is non-mutating from autosave POV)',
    );

    // Now the commit path fires once at onPointerUp / onBlur.
    const obj = current.objects.find(o => o.id === textId)!;
    runPatchTextGeometry(
      {
        scene: current, obj, sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: (s) => { current = s; },
      },
      { letterSpacing: 15 },
    );

    assert(
      hist.cursor === startCursor + 1,
      'commit at end of drag: exactly ONE history entry (was 3 pre-T2-80)',
    );
    assert(
      sceneIsDirtyRef.current === true,
      'commit at end of drag: dirty=true',
    );
  }

  // ── 5. Preview-only path is non-destructive to history (T2-80) ────────
  // Verifies that previewTextGeometry doesn't accidentally call
  // historyRef.current.push or sceneIsDirtyRef mutation — the live-preview
  // contract MUST be safe to fire continuously without polluting state.
  {
    const { scene, textId } = makeSceneWithText('Preview');
    const hist = new HistoryManager();
    hist.push(scene);
    const sceneIsDirtyRef: RefObj<boolean> = { current: false };
    const startCursor = hist.cursor;

    let current: Scene = scene;
    // Many preview ticks — simulate a long drag.
    for (let i = 0; i < 20; i++) {
      const obj = current.objects.find(o => o.id === textId)!;
      const after = runPreviewTextGeometry(
        {
          scene: current, obj, sceneIsDirtyRef,
          historyRef: { current: hist },
          setScene: () => {},
        },
        { letterSpacing: i * 5 },
      );
      current = after!;
    }

    assert(
      hist.cursor === startCursor,
      `preview path: 20 ticks added zero history entries (got cursor delta ${hist.cursor - startCursor})`,
    );
    assert(
      sceneIsDirtyRef.current === false,
      'preview path: 20 ticks did not flip dirty',
    );
    // The scene state still reflects the last preview value (UI shows it).
    const finalObj = current.objects.find(o => o.id === textId)!;
    assert(
      (finalObj.geometry as TextGeometry).letterSpacing === 95,
      `preview path: scene reflects last tick value (got ${(finalObj.geometry as TextGeometry).letterSpacing})`,
    );
  }

  // ── 6. Commit after preview takes the LAST preview value (T2-80) ──────
  // Defense-in-depth for the most common drag pattern: user drags through
  // many values then releases at the final one. The committed history
  // entry should reflect the released value, not any intermediate.
  {
    const { scene, textId } = makeSceneWithText('Commit');
    const hist = new HistoryManager();
    hist.push(scene);
    const sceneIsDirtyRef: RefObj<boolean> = { current: false };

    let current: Scene = scene;

    // Preview through 20 -> 40 -> 60 -> 80, then commit at 80.
    for (const v of [20, 40, 60, 80]) {
      const obj = current.objects.find(o => o.id === textId)!;
      const after = runPreviewTextGeometry(
        {
          scene: current, obj, sceneIsDirtyRef,
          historyRef: { current: hist },
          setScene: () => {},
        },
        { letterSpacing: v },
      );
      current = after!;
    }

    const obj = current.objects.find(o => o.id === textId)!;
    const committed = runPatchTextGeometry(
      {
        scene: current, obj, sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: () => {},
      },
      { letterSpacing: 80 },
    );

    const committedObj = committed!.objects.find(o => o.id === textId)!;
    assert(
      (committedObj.geometry as TextGeometry).letterSpacing === 80,
      `commit value matches release value (got ${(committedObj.geometry as TextGeometry).letterSpacing})`,
    );

    // Undo from this state should restore to BEFORE the drag, not to one
    // of the intermediate preview values. Verifies the coalescing
    // contract from the user's POV.
    const undone = hist.undo();
    const undoneObj = undone!.objects.find(o => o.id === textId)!;
    assert(
      (undoneObj.geometry as TextGeometry).letterSpacing === undefined,
      `undo after slider drag → pre-drag state (letterSpacing was unset; got ${(undoneObj.geometry as TextGeometry).letterSpacing})`,
    );
  }

  // ── 7. Undo restores previous geometry exactly ────────────────────────
  {
    const { scene, textId } = makeSceneWithText('Undo me');
    const hist = new HistoryManager();
    hist.push(scene);
    const sceneIsDirtyRef: RefObj<boolean> = { current: false };

    const obj = scene.objects.find(o => o.id === textId)!;
    const originalFont = (obj.geometry as TextGeometry).fontFamily;

    runPatchTextGeometry(
      {
        scene, obj, sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: () => {},
      },
      { fontFamily: 'Inter' },
    );

    // Now undo
    const restored = hist.undo();
    assert(restored !== null, 'undo returned a scene');
    const restoredObj = restored!.objects.find(o => o.id === textId)!;
    assert(
      (restoredObj.geometry as TextGeometry).fontFamily === originalFont,
      `undo restored fontFamily to original ("${originalFont}")`,
    );
  }

  // ── 8. Non-text geometry: no-op (no history push, no dirty change) ────
  {
    const { scene } = makeSceneWithText('whatever');
    // Build a non-text fake object
    const blank = createScene(100, 100, 'non-text');
    const layerId = blank.layers[0]!.id;
    const rectObj: SceneObject = {
      id: 'rect-x',
      type: 'rect',
      name: 'Rect',
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
    const sceneWithRect: Scene = { ...scene, objects: [rectObj] };
    const hist = new HistoryManager();
    hist.push(sceneWithRect);
    const baselineCursor = hist.cursor;
    const sceneIsDirtyRef: RefObj<boolean> = { current: false };

    const result = runPatchTextGeometry(
      {
        scene: sceneWithRect,
        obj: rectObj,
        sceneIsDirtyRef,
        historyRef: { current: hist },
        setScene: () => {},
      },
      { fontFamily: 'Inter' },
    );

    assert(result === null, 'non-text geometry → patchTextGeometry returns null (early return)');
    assert(
      sceneIsDirtyRef.current === false,
      'non-text geometry → dirty stays false',
    );
    assert(
      hist.cursor === baselineCursor,
      'non-text geometry → no history entry added',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
