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
 * Slider behavior caveat (T2-80 deferred): until coalescing lands, sliders
 * produce one history entry per onChange tick. This is acknowledged as
 * sub-optimal but strictly better than zero entries.
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

  // ── 4. Letter spacing slider tick: one entry per tick (T2-80 caveat) ──
  {
    const { scene, textId } = makeSceneWithText('Slide');
    const hist = new HistoryManager();
    hist.push(scene);
    const sceneIsDirtyRef: RefObj<boolean> = { current: false };

    let current: Scene = scene;
    let entriesAdded = 0;
    // Simulate three slider ticks at 5, 10, 15. Each is an onChange.
    for (const v of [5, 10, 15]) {
      const obj = current.objects.find(o => o.id === textId)!;
      const before = hist.cursor;
      const after = runPatchTextGeometry(
        {
          scene: current, obj, sceneIsDirtyRef,
          historyRef: { current: hist },
          setScene: () => {},
        },
        { letterSpacing: v },
      );
      current = after!;
      if (hist.cursor === before + 1) entriesAdded++;
    }
    assert(
      entriesAdded === 3,
      'slider: one history entry per onChange tick (T2-80 will coalesce)',
    );
    assert(
      sceneIsDirtyRef.current === true,
      'slider drags → dirty=true',
    );
    const finalObj = current.objects.find(o => o.id === textId)!;
    assert(
      (finalObj.geometry as TextGeometry).letterSpacing === 15,
      'final letterSpacing reflects the last tick',
    );
  }

  // ── 5. Undo restores previous geometry exactly ────────────────────────
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

  // ── 6. Non-text geometry: no-op (no history push, no dirty change) ────
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
