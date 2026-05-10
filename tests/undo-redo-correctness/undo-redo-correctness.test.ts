/**
 * T3-80: cross-cutting undo/redo correctness suite.
 *
 * Run: npx tsx tests/undo-redo-correctness/undo-redo-correctness.test.ts
 */
import { createScene, type Scene } from '../../src/core/scene/Scene';
import { createLayer } from '../../src/core/scene/Layer';
import {
  createRect,
  type ImageGeometry,
  type SceneObject,
  type TextGeometry,
} from '../../src/core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../../src/core/types';
import {
  addLayer,
  addObject,
  deleteObjects,
  groupObjects,
  removeLayer,
  updateGeometry,
} from '../../src/ui/history/SceneCommands';
import { HistoryManager } from '../../src/ui/history/HistoryManager';
import {
  makeCommitSceneTransaction,
  type HistoryEntryMetaForward,
  type SceneTransactionDeps,
} from '../../src/ui/scene/SceneTransaction';
import {
  captureSceneRevision,
  isSceneStale,
} from '../../src/ui/hooks/asyncSceneGuard';

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

function setEq<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function withId<T extends SceneObject>(obj: T, id: string): T {
  (obj as { id: string }).id = id;
  return obj;
}

function filterValidIds(ids: ReadonlySet<string>, scene: Scene): Set<string> {
  const sceneIds = new Set(scene.objects.map(o => o.id));
  const valid = new Set<string>();
  for (const id of ids) {
    if (sceneIds.has(id)) valid.add(id);
  }
  return valid;
}

interface UndoRedoState {
  scene: Scene;
  selection: Set<string>;
  dirty: boolean;
  gcodeStale: boolean;
  hasFramed: boolean;
  historyVersion: number;
  preflightInvalidations: number;
}

interface UndoRedoEnv {
  hist: HistoryManager;
  state: UndoRedoState;
  commit: ReturnType<typeof makeCommitSceneTransaction>;
}

function makeEnv(): UndoRedoEnv {
  const hist = new HistoryManager();
  const state: UndoRedoState = {
    scene: createScene(400, 300, 'T3-80 undo redo'),
    selection: new Set<string>(),
    dirty: false,
    gcodeStale: false,
    hasFramed: false,
    historyVersion: 0,
    preflightInvalidations: 0,
  };
  const deps: SceneTransactionDeps = {
    setScene: scene => { state.scene = scene; },
    history: {
      push: (scene, meta) => hist.push(scene, meta as HistoryEntryMetaForward | undefined),
      reset: (scene, meta) => hist.reset(scene, meta as HistoryEntryMetaForward | undefined),
    },
    setSelectedIds: ids => { state.selection = new Set(ids); },
    notifyDirty: dirty => { state.dirty = dirty; },
    getSelection: () => state.selection,
    invalidate: {
      compile: () => { state.gcodeStale = true; },
      frame: () => {
        state.hasFramed = false;
        state.historyVersion += 1;
      },
      preflight: () => { state.preflightInvalidations += 1; },
    },
  };
  const commit = makeCommitSceneTransaction(deps);
  hist.push(state.scene, { action: 'init', selectionAfter: new Set() });
  return { hist, state, commit };
}

function commitEdit(
  env: UndoRedoEnv,
  scene: Scene,
  action: string,
  selectionAfter?: ReadonlySet<string>,
): void {
  env.commit(
    scene,
    { kind: 'edit', action },
    selectionAfter ? { selectionAfter } : undefined,
  );
}

function commitPreview(env: UndoRedoEnv, scene: Scene): void {
  env.commit(scene, { kind: 'preview' });
}

function undo(env: UndoRedoEnv): boolean {
  const entry = env.hist.undoEntry();
  if (!entry) return false;
  env.commit(entry.scene, { kind: 'history', direction: 'undo' }, {
    selectionAfter: filterValidIds(entry.selectionAfter, entry.scene),
  });
  return true;
}

function redo(env: UndoRedoEnv): boolean {
  const entry = env.hist.redoEntry();
  if (!entry) return false;
  env.commit(entry.scene, { kind: 'history', direction: 'redo' }, {
    selectionAfter: filterValidIds(entry.selectionAfter, entry.scene),
  });
  return true;
}

function markCompiled(env: UndoRedoEnv): void {
  env.state.gcodeStale = false;
}

function markFramed(env: UndoRedoEnv): void {
  env.state.hasFramed = true;
}

function objectById(scene: Scene, id: string): SceneObject {
  const obj = scene.objects.find(o => o.id === id);
  if (!obj) throw new Error(`Missing object ${id}`);
  return obj;
}

function makeRectScene(ids: string[]): Scene {
  const scene = createScene(400, 300, 'rects');
  const layerId = scene.layers[0].id;
  scene.objects = ids.map((id, index) =>
    withId(createRect(layerId, index * 10, 0, 5, 5, id), id));
  return scene;
}

function makeTextObject(layerId: string, id = 'text-1'): SceneObject {
  return withId({
    id,
    type: 'text',
    name: 'Name text',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 10, ty: 20 },
    geometry: {
      type: 'text',
      text: 'Alice',
      fontSize: 12,
      fontFamily: 'Arial',
      letterSpacing: 0,
      lineSpacing: 120,
      wordSpacing: 100,
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  }, id);
}

function makeImageObject(layerId: string, id = 'image-1'): SceneObject {
  const grayscaleData = new Uint8Array([0, 127, 255, 64]);
  return withId({
    id,
    type: 'image',
    name: 'Image',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: {
      type: 'image',
      src: 'data:image/png;base64,AA==',
      originalWidth: 2,
      originalHeight: 2,
      cropX: 0,
      cropY: 0,
      cropWidth: 2,
      cropHeight: 2,
      grayscaleData,
      grayscaleWidth: 2,
      grayscaleHeight: 2,
      brightness: 0,
      processedData: new Uint8Array([1, 2, 3, 4]),
      processedSettings: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  }, id);
}

function replaceObject(scene: Scene, next: SceneObject): Scene {
  return { ...scene, objects: scene.objects.map(obj => obj.id === next.id ? next : obj) };
}

console.log('\n=== T3-80 undo/redo correctness suite ===\n');

{
  const env = makeEnv();
  const scene = makeRectScene(['a', 'b']);
  env.hist.reset(scene, { action: 'load:test', selectionAfter: new Set(['b']) });
  env.state.scene = scene;
  env.state.dirty = false;
  const next = deleteObjects(scene, new Set(['b']));
  commitEdit(env, next, 'delete', new Set());
  assert(Boolean(env.state.dirty), 'delete marks scene dirty');
  assert(env.hist.getCurrentEntry()?.action === 'delete', 'delete creates a named history entry');
}

{
  const env = makeEnv();
  const scene = makeRectScene(['a']);
  commitEdit(env, scene, 'load-rects', new Set(['a']));
  markCompiled(env);
  const edited = updateGeometry(scene, 'a', { type: 'rect', x: 0, y: 0, width: 20, height: 5, cornerRadius: 0 });
  commitEdit(env, edited, 'resize', new Set(['a']));
  markCompiled(env);
  assert(undo(env), 'undo after compile applies');
  assert(env.state.gcodeStale === true, 'undo after compile invalidates G-code');
  assert(env.state.preflightInvalidations > 0, 'undo after compile invalidates preflight');
}

{
  const env = makeEnv();
  const scene = makeRectScene(['a']);
  commitEdit(env, scene, 'load-rects', new Set(['a']));
  markFramed(env);
  const moved = { ...scene, objects: [{ ...scene.objects[0], transform: { ...scene.objects[0].transform, tx: 40 } }] };
  commitEdit(env, moved, 'move', new Set(['a']));
  markFramed(env);
  assert(undo(env), 'undo after frame applies');
  assert(env.state.hasFramed === false, 'undo after frame marks frame stale');
  assert(env.state.historyVersion > 0, 'undo after frame bumps history version');
}

{
  const env = makeEnv();
  const scene = makeRectScene(['a']);
  commitEdit(env, scene, 'load-rects', new Set(['a']));
  const moved = { ...scene, objects: [{ ...scene.objects[0], transform: { ...scene.objects[0].transform, tx: 40 } }] };
  commitEdit(env, moved, 'move', new Set(['a']));
  undo(env);
  markCompiled(env);
  markFramed(env);
  assert(redo(env), 'redo applies after undo');
  assert(env.state.gcodeStale === true, 'redo invalidates G-code');
  assert(env.state.hasFramed === false, 'redo marks frame stale');
}

{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0].id;
  const text = makeTextObject(layerId);
  const scene = addObject(env.state.scene, text);
  commitEdit(env, scene, 'text-add', new Set([text.id]));
  const changedGeom: TextGeometry = { ...(text.geometry as TextGeometry), fontFamily: 'Georgia' };
  const changed = updateGeometry(scene, text.id, changedGeom);
  commitEdit(env, changed, 'text-edit', new Set([text.id]));
  undo(env);
  assert((objectById(env.state.scene, text.id).geometry as TextGeometry).fontFamily === 'Arial',
    'undo restores previous text font');
  redo(env);
  assert((objectById(env.state.scene, text.id).geometry as TextGeometry).fontFamily === 'Georgia',
    'redo reapplies text font');
}

{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0].id;
  const text = makeTextObject(layerId);
  const scene = addObject(env.state.scene, text);
  commitEdit(env, scene, 'text-add', new Set([text.id]));
  const cursorBefore = env.hist.cursor;
  for (const spacing of [10, 20, 30]) {
    const geom = { ...(text.geometry as TextGeometry), letterSpacing: spacing };
    commitPreview(env, updateGeometry(scene, text.id, geom));
  }
  assert(env.hist.cursor === cursorBefore, 'text spacing preview ticks do not add history entries');
  const finalGeom = { ...(text.geometry as TextGeometry), letterSpacing: 30 };
  commitEdit(env, updateGeometry(scene, text.id, finalGeom), 'text-edit', new Set([text.id]));
  assert(env.hist.cursor === cursorBefore + 1, 'text spacing commit adds one history entry');
  undo(env);
  assert(((objectById(env.state.scene, text.id).geometry as TextGeometry).letterSpacing ?? 0) === 0,
    'undo text spacing returns to original spacing');
}

{
  const env = makeEnv();
  const scene = env.state.scene;
  const layer = scene.layers[0];
  const cursorBefore = env.hist.cursor;
  for (const power of [20, 40, 60]) {
    commitPreview(env, {
      ...scene,
      layers: [{ ...layer, settings: { ...layer.settings, power: { ...layer.settings.power, max: power } } }],
    });
  }
  assert(env.hist.cursor === cursorBefore, 'layer power preview ticks do not add history entries');
  const committed = {
    ...scene,
    layers: [{ ...layer, settings: { ...layer.settings, power: { ...layer.settings.power, max: 60 } } }],
  };
  commitEdit(env, committed, 'layer-setting');
  assert(env.hist.cursor === cursorBefore + 1, 'layer power commit adds one history entry');
  undo(env);
  assert(env.state.scene.layers[0].settings.power.max === layer.settings.power.max,
    'undo layer power returns to original value');
}

{
  const env = makeEnv();
  const layerId = env.state.scene.layers[0].id;
  const image = makeImageObject(layerId);
  const scene = addObject(env.state.scene, image);
  commitEdit(env, scene, 'image-import', new Set([image.id]));
  const cursorBefore = env.hist.cursor;
  for (const brightness of [10, 20, 30]) {
    const geom = { ...(image.geometry as ImageGeometry), brightness };
    commitPreview(env, replaceObject(scene, { ...image, geometry: geom }));
  }
  assert(env.hist.cursor === cursorBefore, 'image brightness preview ticks do not add history entries');
  const finalGeom = { ...(image.geometry as ImageGeometry), brightness: 30 };
  commitEdit(env, replaceObject(scene, { ...image, geometry: finalGeom }), 'image-edit', new Set([image.id]));
  assert(env.hist.cursor === cursorBefore + 1, 'image brightness commit adds one history entry');
}

{
  const env = makeEnv();
  const token = captureSceneRevision(env.state.scene);
  const edited = makeRectScene(['a']);
  commitEdit(env, edited, 'draw', new Set(['a']));
  assert(isSceneStale(token, env.state.scene), 'async producer detects scene identity drift');
}

{
  const env = makeEnv();
  const token = captureSceneRevision(env.state.scene);
  const userEdit = makeRectScene(['user-edit']);
  commitEdit(env, userEdit, 'draw', new Set(['user-edit']));
  const staleImportResult = makeRectScene(['stale-import']);
  if (!isSceneStale(token, env.state.scene)) {
    commitEdit(env, staleImportResult, 'image-import');
  }
  assert(env.state.scene.objects.some(o => o.id === 'user-edit'), 'stale async import does not erase current edit');
  assert(!env.state.scene.objects.some(o => o.id === 'stale-import'), 'stale async import result is discarded');
}

{
  const env = makeEnv();
  const extraLayer = createLayer(1, 'engrave', 'Engrave');
  const withLayer = addLayer(env.state.scene, extraLayer);
  const obj = withId(createRect(extraLayer.id, 10, 10, 5, 5, 'layer-child'), 'layer-child');
  const withObject = addObject(withLayer, obj);
  commitEdit(env, withObject, 'layer-add', new Set([obj.id]));
  const removed = removeLayer(withObject, extraLayer.id);
  commitEdit(env, removed, 'layer-delete', new Set());
  undo(env);
  assert(env.state.scene.layers.some(l => l.id === extraLayer.id), 'undo layer delete restores layer');
  assert(env.state.scene.objects.some(o => o.id === obj.id), 'undo layer delete restores layer objects');
  redo(env);
  assert(!env.state.scene.layers.some(l => l.id === extraLayer.id), 'redo layer delete removes layer');
  assert(!env.state.scene.objects.some(o => o.id === obj.id), 'redo layer delete removes layer objects');
}

{
  const env = makeEnv();
  const scene = makeRectScene(['a', 'b']);
  commitEdit(env, scene, 'load-rects', new Set(['a', 'b']));
  const deleted = deleteObjects(scene, new Set(['b']));
  commitEdit(env, deleted, 'delete', new Set());
  undo(env);
  assert(setEq(env.state.selection, new Set(['a', 'b'])), 'undo delete restores previous selection');
}

{
  const hist = new HistoryManager();
  const scene = createScene(400, 300, 'image-heavy');
  const image = makeImageObject(scene.layers[0].id);
  const withImage = addObject(scene, image);
  hist.push(withImage, { action: 'image-edit', selectionAfter: new Set([image.id]) });
  const current = hist.getCurrentEntry()?.scene;
  const geom = current?.objects[0]?.geometry as ImageGeometry | undefined;
  assert(geom?.grayscaleData instanceof Uint8Array, 'history keeps canonical grayscale image data');
  assert(geom?.processedData == null, 'history strips regenerable processed image cache');
}

{
  const env = makeEnv();
  const sceneA = makeRectScene(['a']);
  commitEdit(env, sceneA, 'draw-a', new Set(['a']));
  const sceneAB = { ...sceneA, objects: [...sceneA.objects, withId(createRect(sceneA.layers[0].id, 20, 0, 5, 5, 'b'), 'b')] };
  commitEdit(env, sceneAB, 'draw-b', new Set(['b']));
  undo(env);
  const sceneAC = { ...env.state.scene, objects: [...env.state.scene.objects, withId(createRect(sceneA.layers[0].id, 30, 0, 5, 5, 'c'), 'c')] };
  commitEdit(env, sceneAC, 'draw-c', new Set(['c']));
  assert(env.hist.canRedo() === false, 'new edit after undo truncates redo history');
  assert(env.state.scene.objects.some(o => o.id === 'c'), 'branch edit is current');
  assert(!env.state.scene.objects.some(o => o.id === 'b'), 'discarded redo object stays absent');
}

{
  const env = makeEnv();
  const scene = makeRectScene(['a', 'b']);
  commitEdit(env, scene, 'load-rects', new Set(['a', 'b']));
  const grouped = groupObjects(scene, new Set(['a', 'b']), { groupId: 'group-1' });
  commitEdit(env, grouped, 'group', new Set(['group-1']));
  undo(env);
  assert(setEq(env.state.selection, new Set(['a', 'b'])), 'undo group restores object selection');
  redo(env);
  assert(setEq(env.state.selection, new Set(['group-1'])), 'redo group selects group marker');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
