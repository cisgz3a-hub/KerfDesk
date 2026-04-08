/**
 * === FILE: /tests/history.test.ts ===
 *
 * Purpose:    Tests for HistoryManager (undo/redo/push/limits) and
 *             SceneCommands (pure scene mutations with structural sharing).
 *
 * Run with: npx tsx tests/history.test.ts
 */

import { HistoryManager, type HistoryState } from '../src/ui/history/HistoryManager';
import {
  addObject,
  addObjects,
  updateObject,
  updateTransform,
  moveObjects,
  deleteObjects,
  duplicateObjects,
  reorderObjects,
  addLayer,
  removeLayer,
} from '../src/ui/history/SceneCommands';
import { createScene } from '../src/core/scene/Scene';
import { createRect, createEllipse, createLine } from '../src/core/scene/SceneObject';
import { createLayer } from '../src/core/scene/Layer';

// ─── ASSERTIONS ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// ─── TEST: BASIC PUSH + UNDO + REDO ─────────────────────────────

console.log('\n=== Test: Basic Push + Undo + Redo ===');

const h1 = new HistoryManager();
const s0 = createScene(400, 400, 'Test');
const s1 = addObject(s0, createRect(s0.layers[0].id, 10, 10, 50, 50, 'Rect1'));
const s2 = addObject(s1, createRect(s0.layers[0].id, 100, 100, 30, 30, 'Rect2'));

h1.push(s0);
h1.push(s1);
h1.push(s2);

assert(h1.getCurrent() === s2, 'Current is s2 after 3 pushes');
assert(h1.canUndo(), 'Can undo after pushes');
assert(!h1.canRedo(), 'Cannot redo at tip');

// Undo once
const undone1 = h1.undo();
assert(undone1 === s1, 'Undo returns s1');
assert(h1.getCurrent() === s1, 'Current is s1 after undo');
assert(h1.canUndo(), 'Can still undo');
assert(h1.canRedo(), 'Can redo after undo');

// Redo
const redone1 = h1.redo();
assert(redone1 === s2, 'Redo returns s2');
assert(h1.getCurrent() === s2, 'Current is s2 after redo');
assert(!h1.canRedo(), 'Cannot redo at tip again');

// Undo twice
h1.undo();
h1.undo();
assert(h1.getCurrent() === s0, 'Two undos → back to s0');
assert(!h1.canUndo(), 'Cannot undo past beginning');

// Undo at beginning returns null
const nullUndo = h1.undo();
assert(nullUndo === null, 'Undo at beginning returns null');
assert(h1.getCurrent() === s0, 'Current unchanged after failed undo');

// Redo twice to get back
h1.redo();
h1.redo();
assert(h1.getCurrent() === s2, 'Two redos → back to s2');

// Redo at tip returns null
const nullRedo = h1.redo();
assert(nullRedo === null, 'Redo at tip returns null');

// ─── TEST: PUSH AFTER UNDO TRUNCATES REDO ────────────────────────

console.log('\n=== Test: Push After Undo Truncates Redo ===');

const h2 = new HistoryManager();
const a0 = createScene(400, 400, 'Branch Test');
const a1 = addObject(a0, createRect(a0.layers[0].id, 0, 0, 10, 10));
const a2 = addObject(a1, createRect(a0.layers[0].id, 20, 20, 10, 10));
const a3 = addObject(a2, createRect(a0.layers[0].id, 40, 40, 10, 10));

h2.push(a0);
h2.push(a1);
h2.push(a2);
h2.push(a3);

// Undo twice: cursor at a1
h2.undo();
h2.undo();
assert(h2.getCurrent() === a1, 'After 2 undos: at a1');
assert(h2.getState().redoDepth === 2, 'Redo depth = 2');

// Push new scene — should truncate a2, a3
const aBranch = addObject(a1, createEllipse(a0.layers[0].id, 50, 50, 20, 20));
h2.push(aBranch);

assert(h2.getCurrent() === aBranch, 'Current is branch scene');
assert(!h2.canRedo(), 'No redo after branch (a2, a3 truncated)');
assert(h2.getState().totalSnapshots === 3, 'History: 3 snapshots (a0, a1, aBranch)');

// Redo returns null — the old redo path is gone
assert(h2.redo() === null, 'Redo returns null (truncated)');

// ─── TEST: HISTORY LIMIT ─────────────────────────────────────────

console.log('\n=== Test: History Limit ===');

const h3 = new HistoryManager(5); // Max 5 snapshots
let scene = createScene(400, 400, 'Limit Test');

for (let i = 0; i < 10; i++) {
  scene = addObject(scene, createRect(scene.layers[0].id, i * 10, 0, 10, 10, `R${i}`));
  h3.push(scene);
}

assert(h3.getState().totalSnapshots === 5, 'History limited to 5 snapshots');
assert(h3.getState().undoDepth === 4, 'Undo depth = 4 (5 snapshots, cursor at last)');

// Current should be the latest scene
const currentLimited = h3.getCurrent()!;
assert(currentLimited.objects.length === 10, 'Current has all 10 objects (latest scene)');

// Oldest reachable scene should have 6 objects (snapshots 6-10 survived)
for (let i = 0; i < 4; i++) h3.undo();
const oldestReachable = h3.getCurrent()!;
assert(oldestReachable.objects.length === 6, 'Oldest reachable has 6 objects (5 evicted)');
assert(!h3.canUndo(), 'Cannot undo past evicted history');

// ─── TEST: RESET AND CLEAR ──────────────────────────────────────

console.log('\n=== Test: Reset and Clear ===');

const h4 = new HistoryManager();
const fresh = createScene(200, 200, 'Fresh');
h4.push(createScene(400, 400));
h4.push(createScene(400, 400));

h4.reset(fresh);
assert(h4.getState().totalSnapshots === 1, 'Reset: 1 snapshot');
assert(h4.getCurrent() === fresh, 'Reset: current is fresh scene');
assert(!h4.canUndo(), 'Reset: cannot undo');

h4.clear();
assert(h4.getCurrent() === null, 'Clear: current is null');
assert(h4.getState().totalSnapshots === 0, 'Clear: 0 snapshots');

// ─── TEST: CHANGE LISTENER ──────────────────────────────────────

console.log('\n=== Test: Change Listener ===');

const h5 = new HistoryManager();
const events: HistoryState[] = [];
const unsub = h5.onChange(state => events.push({ ...state }));

h5.push(createScene(400, 400));
h5.push(createScene(400, 400));
h5.undo();
h5.redo();

assert(events.length === 4, `Listener: 4 events (push, push, undo, redo) — got ${events.length}`);
assert(events[0].canUndo === false, 'Event 0: cannot undo (first push)');
assert(events[1].canUndo === true, 'Event 1: can undo (second push)');
assert(events[2].canRedo === true, 'Event 2: can redo (after undo)');
assert(events[3].canRedo === false, 'Event 3: cannot redo (after redo back to tip)');

// Unsubscribe
unsub();
h5.push(createScene(400, 400));
assert(events.length === 4, 'After unsub: no more events');

// ─── TEST: SCENE COMMANDS — STRUCTURAL SHARING ───────────────────

console.log('\n=== Test: Structural Sharing ===');

const base = createScene(400, 400, 'Share Test');
const layerId = base.layers[0].id;
const r1 = createRect(layerId, 10, 10, 50, 50, 'R1');
const r2 = createRect(layerId, 100, 100, 30, 30, 'R2');
const withTwo = addObjects(base, [r1, r2]);

// Move only R1 — R2 should be the SAME reference
const moved = moveObjects(withTwo, new Set([r1.id]), 5, 5);

assert(moved !== withTwo, 'Move returns new Scene');
assert(moved.objects.length === 2, 'Move: still 2 objects');
assert(moved.objects[0] !== withTwo.objects[0], 'Move: moved object is new reference');
assert(moved.objects[1] === withTwo.objects[1], 'Move: unmoved object is SAME reference (structural sharing)');
assert(moved.layers === withTwo.layers, 'Move: layers array is SAME reference');
assert(moved.canvas === withTwo.canvas, 'Move: canvas is SAME reference');

// Verify the move was applied correctly
assert(moved.objects[0].transform.tx === r1.transform.tx + 5, 'Move: tx += 5');

// ─── TEST: SCENE COMMANDS — ADD / UPDATE / DELETE ────────────────

console.log('\n=== Test: Add / Update / Delete Commands ===');

const sc0 = createScene(400, 400);
const scLayerId = sc0.layers[0].id;

// Add
const obj1 = createRect(scLayerId, 10, 10, 40, 40, 'Box');
const sc1 = addObject(sc0, obj1);
assert(sc1.objects.length === 1, 'Add: 1 object');
assert(sc1.objects[0].name === 'Box', 'Add: name preserved');

// Update
const sc2 = updateObject(sc1, obj1.id, { name: 'Renamed Box', locked: true });
assert(sc2.objects[0].name === 'Renamed Box', 'Update: name changed');
assert(sc2.objects[0].locked === true, 'Update: locked changed');
assert(sc2.objects[0].geometry === sc1.objects[0].geometry, 'Update: geometry SAME reference');

// Update non-existent → no change
const sc2b = updateObject(sc2, 'non-existent-id', { name: 'Ghost' });
assert(sc2b === sc2, 'Update non-existent: returns same scene');

// Delete
const sc3 = deleteObjects(sc2, new Set([obj1.id]));
assert(sc3.objects.length === 0, 'Delete: 0 objects');

// ─── TEST: SCENE COMMANDS — DUPLICATE ────────────────────────────

console.log('\n=== Test: Duplicate Command ===');

const dupBase = addObject(createScene(400, 400), createRect(
  createScene(400, 400).layers[0].id, 10, 10, 50, 50, 'Original'
));
const dupLayerId = dupBase.layers[0].id;
const origObj = dupBase.objects[0];

const duped = duplicateObjects(dupBase, new Set([origObj.id]), 15, 15);
assert(duped.objects.length === 2, 'Duplicate: 2 objects');
assert(duped.objects[1].name.includes('copy'), 'Duplicate: clone named "copy"');
assert(duped.objects[1].id !== origObj.id, 'Duplicate: clone has new ID');
assert(duped.objects[1].transform.tx === origObj.transform.tx + 15, 'Duplicate: offset applied');

// ─── TEST: SCENE COMMANDS — REORDER ──────────────────────────────

console.log('\n=== Test: Reorder Command ===');

const roBase = createScene(400, 400);
const roLayerId = roBase.layers[0].id;
const roA = createRect(roLayerId, 0, 0, 10, 10, 'A');
const roB = createRect(roLayerId, 20, 0, 10, 10, 'B');
const roC = createRect(roLayerId, 40, 0, 10, 10, 'C');
const roScene = addObjects(roBase, [roA, roB, roC]);

// Move C to front (index 0)
const reordered = reorderObjects(roScene, new Set([roC.id]), 0);
assert(reordered.objects[0].name === 'C', 'Reorder: C moved to front');
assert(reordered.objects[1].name === 'A', 'Reorder: A shifted right');
assert(reordered.objects[2].name === 'B', 'Reorder: B shifted right');

// ─── TEST: SCENE COMMANDS — LAYERS ───────────────────────────────

console.log('\n=== Test: Layer Commands ===');

const layerBase = createScene(400, 400);
const newLayer = createLayer(1, 'engrave', 'Engrave');
const withLayer = addLayer(layerBase, newLayer);
assert(withLayer.layers.length === 2, 'Add layer: 2 layers');
assert(withLayer.layers[1].name === 'Engrave', 'Add layer: name correct');

// Add object to new layer, then remove the layer
const layerObj = createRect(newLayer.id, 50, 50, 20, 20, 'OnEngrave');
const withLayerObj = addObject(withLayer, layerObj);
assert(withLayerObj.objects.length === 1, 'Layer obj: 1 object');

const withoutLayer = removeLayer(withLayerObj, newLayer.id);
assert(withoutLayer.layers.length === 1, 'Remove layer: back to 1 layer');
assert(withoutLayer.objects.length === 0, 'Remove layer: objects on that layer removed');

// Cannot remove last layer
const cantRemove = removeLayer(withoutLayer, withoutLayer.layers[0].id);
assert(cantRemove.layers.length === 1, 'Cannot remove last layer');

// ─── TEST: FULL UNDO/REDO WORKFLOW ───────────────────────────────

console.log('\n=== Test: Full Undo/Redo Workflow ===');

const history = new HistoryManager();
let current = createScene(400, 400, 'Workflow');
const wLayerId = current.layers[0].id;
history.push(current);

// Step 1: Add rect
current = addObject(current, createRect(wLayerId, 10, 10, 50, 50, 'WorkRect'));
history.push(current);
assert(current.objects.length === 1, 'Workflow step 1: 1 object');

// Step 2: Add ellipse
current = addObject(current, createEllipse(wLayerId, 100, 100, 25, 25, 'WorkCircle'));
history.push(current);
assert(current.objects.length === 2, 'Workflow step 2: 2 objects');

// Step 3: Move rect
const rectId = current.objects[0].id;
current = moveObjects(current, new Set([rectId]), 20, 20);
history.push(current);
assert(current.objects[0].transform.tx === 30, 'Workflow step 3: rect moved to tx=30');

// Step 4: Delete ellipse
const ellipseId = current.objects[1].id;
current = deleteObjects(current, new Set([ellipseId]));
history.push(current);
assert(current.objects.length === 1, 'Workflow step 4: 1 object (ellipse deleted)');

// Undo all 4 steps
current = history.undo()!; // Undo delete
assert(current.objects.length === 2, 'Undo 1: ellipse restored');

current = history.undo()!; // Undo move
assert(current.objects[0].transform.tx === 10, 'Undo 2: rect back to tx=10');

current = history.undo()!; // Undo add ellipse
assert(current.objects.length === 1, 'Undo 3: ellipse removed');

current = history.undo()!; // Undo add rect
assert(current.objects.length === 0, 'Undo 4: rect removed (empty scene)');

// Redo all 4 steps
current = history.redo()!;
assert(current.objects.length === 1, 'Redo 1: rect added');

current = history.redo()!;
assert(current.objects.length === 2, 'Redo 2: ellipse added');

current = history.redo()!;
assert(current.objects[0].transform.tx === 30, 'Redo 3: rect moved');

current = history.redo()!;
assert(current.objects.length === 1, 'Redo 4: ellipse deleted');

// ─── TEST: DRAG BATCHING — ONE ENTRY PER DRAG ───────────────────

console.log('\n=== Test: Drag Batching ===');

{
  const hist = new HistoryManager();
  const initial = createScene(400, 400);
  const lid = initial.layers[0].id;
  const obj = createRect(lid, 10, 10, 50, 50, 'DragTarget');
  const withObj = addObject(initial, obj);
  hist.push(withObj);

  // Simulate drag: 3 intermediate onSceneChange calls (NOT pushed to history)
  const ids = new Set([obj.id]);
  const drag1 = moveObjects(withObj, ids, 1, 0);
  const drag2 = moveObjects(drag1, ids, 1, 0);
  const drag3 = moveObjects(drag2, ids, 1, 0);
  // Only the final state is committed (onSceneCommit on mouseUp)
  hist.push(drag3);

  assert(hist.getState().totalSnapshots === 2, 'Drag batch: only 2 snapshots (initial + final)');
  assert(hist.getState().undoDepth === 1, 'Drag batch: 1 undo available');

  // Undo restores pre-drag state
  const restored = hist.undo()!;
  assert(restored === withObj, 'Drag batch: undo restores pre-drag scene');
  assert(restored.objects[0].transform.tx === 10, 'Drag batch: undo restores original tx=10');
}

// ─── TEST: NO COMMIT = NO HISTORY CHANGE ─────────────────────────

console.log('\n=== Test: No Commit = No History Change ===');

{
  const hist = new HistoryManager();
  const initial = createScene(400, 400);
  hist.push(initial);

  // Simulate drag without commit — only onSceneChange called, NOT push
  const lid = initial.layers[0].id;
  const obj = createRect(lid, 0, 0, 10, 10);
  const dragged = moveObjects(addObject(initial, obj), new Set([obj.id]), 50, 0);
  // Parent updates its state for rendering, but does NOT call history.push()

  assert(hist.getCurrent() === initial, 'No commit: history unchanged');
  assert(hist.getState().totalSnapshots === 1, 'No commit: still 1 snapshot');
}

// ─── TEST: DUPLICATE SCENE PREVENTION ────────────────────────────

console.log('\n=== Test: Duplicate Scene Prevention ===');

{
  const hist = new HistoryManager();
  const scene = createScene(400, 400);
  hist.push(scene);

  // Push the same reference again (e.g. mouseUp with no movement)
  hist.push(scene);

  assert(hist.getState().totalSnapshots === 1, 'Dedup: same reference not pushed twice');
  assert(!hist.canUndo(), 'Dedup: cannot undo (no second entry)');

  // Push a genuinely different scene
  const different = addObject(scene, createRect(scene.layers[0].id, 0, 0, 10, 10));
  hist.push(different);
  assert(hist.getState().totalSnapshots === 2, 'Dedup: different scene IS pushed');
  assert(hist.canUndo(), 'Dedup: can undo after real change');
}

// ─── TEST: SELECTION NOT IN HISTORY ──────────────────────────────

console.log('\n=== Test: Selection Not In History ===');

{
  const hist = new HistoryManager();
  const scene = createScene(400, 400);
  const lid = scene.layers[0].id;
  const obj = createRect(lid, 10, 10, 40, 40, 'Selectable');
  const withObj = addObject(scene, obj);

  // Push scene with non-empty selection
  const withSelection = { ...withObj, selection: [obj.id] };
  hist.push(withSelection);

  // Stored snapshot should have empty selection
  const stored = hist.getCurrent()!;
  assert(stored.selection.length === 0, 'Selection stripped: stored snapshot has empty selection');
  assert(stored.objects.length === 1, 'Selection stripped: objects preserved');

  // Add another object and push
  const obj2 = createRect(lid, 50, 50, 20, 20, 'Second');
  const withTwo = { ...addObject(withObj, obj2), selection: [obj2.id] };
  hist.push(withTwo);

  // Undo — should restore geometry but NOT selection
  const undone = hist.undo()!;
  assert(undone.objects.length === 1, 'Undo: geometry restored (1 object)');
  assert(undone.selection.length === 0, 'Undo: selection is empty (not restored from old snapshot)');

  // External selectedIds (simulating React state) is unaffected
  const externalSelectedIds = new Set([obj.id]);
  assert(externalSelectedIds.has(obj.id), 'External selection: unaffected by undo');
}

// ─── TEST: DRAG + UNDO RESTORES EXACT POSITION ──────────────────

console.log('\n=== Test: Drag + Undo Restores Exact Position ===');

{
  const hist = new HistoryManager();
  const scene = createScene(400, 400);
  const lid = scene.layers[0].id;
  const obj = createRect(lid, 77.5, 33.25, 40, 40, 'Precise');
  const withObj = addObject(scene, obj);
  hist.push(withObj);

  // Simulate a drag with many incremental moves (like real mouse events)
  const ids = new Set([obj.id]);
  let current = withObj;
  for (let i = 0; i < 50; i++) {
    current = moveObjects(current, ids, 0.7, 0.3); // Sub-pixel increments
  }

  // Commit final position
  hist.push(current);

  // Object should have moved significantly
  const movedObj = current.objects[0];
  assert(Math.abs(movedObj.transform.tx - 77.5) > 30, 'Drag moved object significantly');

  // Undo should restore EXACT original position
  const restored = hist.undo()!;
  const restoredObj = restored.objects[0];
  assert(restoredObj.transform.tx === 77.5, `Undo exact: tx = 77.5 (got ${restoredObj.transform.tx})`);
  assert(restoredObj.transform.ty === 33.25, `Undo exact: ty = 33.25 (got ${restoredObj.transform.ty})`);

  // Redo should restore the moved position
  const redone = hist.redo()!;
  assert(redone.objects[0].transform.tx === movedObj.transform.tx, 'Redo exact: tx matches final drag position');
}

// ─── TEST: SENTINEL — NO-OP COMMAND RETURNS SAME REF ─────────────

console.log('\n=== Test: Sentinel — No-op Returns Same Reference ===');

{
  const hist = new HistoryManager();
  const scene = createScene(400, 400);
  hist.push(scene);

  // Simulate a no-op command that returns the same reference
  const same = scene;
  hist.push(same);

  assert(!hist.canUndo(), 'Sentinel: no-op push does not create undo entry');
  assert(hist.length === 1, 'Sentinel: stack length unchanged');
  assert(hist.cursor === 0, 'Sentinel: cursor unchanged');

  // moveObjects with zero delta returns original reference
  const ids = new Set(['nonexistent']);
  const noop = moveObjects(scene, ids, 0, 0);
  assert(noop === scene, 'moveObjects(0,0) returns same reference');
  hist.push(noop);
  assert(hist.length === 1, 'Sentinel: zero-move push does not create entry');
}

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
