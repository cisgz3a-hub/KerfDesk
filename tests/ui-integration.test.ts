/**
 * === FILE: /tests/ui-integration.test.ts ===
 *
 * Purpose:    Tests for the UI integration layer: App data flow,
 *             file operations, and history wiring. Tests the logic
 *             without rendering React components (no DOM needed).
 *
 * Run with: npx tsx tests/ui-integration.test.ts
 */

import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { HistoryManager } from '../src/ui/history/HistoryManager';
import { importSvgIntoScene } from '../src/import/svg/SvgToScene';
import { serializeScene, deserializeScene } from '../src/io/SceneSerializer';
import { addObject } from '../src/ui/history/SceneCommands';
import { moveObjects } from '../src/core/scene/SceneOps';

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

function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) < tol, `${msg} (got ${actual.toFixed(3)}, expected ${expected})`);
}

// ─── TEST SVG FIXTURE ────────────────────────────────────────────

const testSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80"/>
  <circle cx="50" cy="50" r="20"/>
</svg>`;

// ─── TEST: NEW PROJECT FLOW ──────────────────────────────────────

console.log('\n=== Test: New Project Flow ===');

{
  // Simulate: App creates initial scene → user adds objects → clicks New
  const history = new HistoryManager();
  let scene = createScene(400, 300, 'Original');
  history.push(scene);

  // User adds objects
  scene = addObject(scene, createRect(scene.layers[0].id, 10, 10, 50, 50));
  history.push(scene);
  assert(scene.objects.length === 1, 'New: starts with 1 object');

  // User clicks "New" → creates fresh scene, commits to history
  const newScene = createScene(400, 300, 'Untitled');
  history.push(newScene);
  scene = newScene;

  assert(scene.objects.length === 0, 'New: scene has 0 objects');
  assert(scene.metadata.name === 'Untitled', 'New: name is Untitled');

  // Undo should restore the previous scene with objects
  const undone = history.undo()!;
  assert(undone.objects.length === 1, 'New→Undo: restores 1 object');
}

// ─── TEST: SVG IMPORT FLOW ───────────────────────────────────────

console.log('\n=== Test: SVG Import Flow ===');

{
  const history = new HistoryManager();
  let scene = createScene(400, 300, 'Canvas');
  const layerId = scene.layers[0].id;
  history.push(scene);

  // Simulate: user clicks Import SVG → file is read → importSvgIntoScene called
  const updated = importSvgIntoScene(testSvg, scene, layerId, {
    mode: 'fit',
    allowScaleUp: false,
  });

  // onSceneChange + onSceneCommit
  scene = updated;
  history.push(scene);

  assert(scene.objects.length === 2, 'Import: 2 objects from SVG');
  assert(scene.objects[0].geometry.type === 'rect', 'Import: first is rect');
  assert(scene.objects[1].geometry.type === 'ellipse', 'Import: second is circle→ellipse');

  // Objects should be on the target layer
  assert(scene.objects.every(o => o.layerId === layerId), 'Import: all on target layer');

  // Undo should remove the imported objects
  const undone = history.undo()!;
  assert(undone.objects.length === 0, 'Import→Undo: back to 0 objects');

  // Redo should restore them
  const redone = history.redo()!;
  assert(redone.objects.length === 2, 'Import→Redo: 2 objects restored');
}

// ─── TEST: SAVE ROUNDTRIP FLOW ───────────────────────────────────

console.log('\n=== Test: Save Roundtrip Flow ===');

{
  // Build a scene with content
  let scene = createScene(400, 300, 'SaveTest');
  const lid = scene.layers[0].id;
  scene = addObject(scene, createRect(lid, 50, 50, 100, 80, 'MyRect'));
  scene = addObject(scene, createRect(lid, 200, 100, 60, 60, 'MySquare'));

  // Simulate save: serializeScene produces JSON
  const json = serializeScene(scene);
  assert(json.length > 0, 'Save: produces JSON');
  assert(json.includes('laserforge'), 'Save: JSON has format identifier');
  assert(json.includes('MyRect'), 'Save: JSON contains object name');

  // Simulate load: deserializeScene restores the scene
  const loaded = deserializeScene(json);
  assert(loaded.objects.length === 2, 'Load: 2 objects');
  assert(loaded.objects[0].name === 'MyRect', 'Load: first object name');
  assert(loaded.objects[1].name === 'MySquare', 'Load: second object name');
  assert(loaded.metadata.name === 'SaveTest', 'Load: project name');

  // IDs must match
  assert(loaded.id === scene.id, 'Load: scene ID preserved');
  assert(loaded.objects[0].id === scene.objects[0].id, 'Load: object ID preserved');
}

// ─── TEST: UNDO/REDO KEYBOARD SIMULATION ─────────────────────────

console.log('\n=== Test: Undo/Redo Keyboard Simulation ===');

{
  // Simulate the App's keyboard handler logic without DOM
  const history = new HistoryManager();
  let scene = createScene(400, 300);
  const lid = scene.layers[0].id;
  history.push(scene);

  // Step 1: Add rect
  scene = addObject(scene, createRect(lid, 10, 10, 50, 50));
  history.push(scene);

  // Step 2: Move rect
  scene = moveObjects(scene, new Set([scene.objects[0].id]), 20, 20);
  history.push(scene);

  // Step 3: Add another rect
  scene = addObject(scene, createRect(lid, 100, 100, 30, 30));
  history.push(scene);

  assert(scene.objects.length === 2, 'KB: 2 objects after 3 steps');
  assert(history.getState().undoDepth === 3, 'KB: 3 undos available');

  // Simulate Ctrl+Z (undo)
  const undo1 = history.undo()!;
  scene = undo1;
  assert(scene.objects.length === 1, 'KB Ctrl+Z 1: back to 1 object');

  const undo2 = history.undo()!;
  scene = undo2;
  assert(scene.objects[0].transform.tx === 10, 'KB Ctrl+Z 2: move undone (tx=10)');

  // Simulate Ctrl+Y (redo)
  const redo1 = history.redo()!;
  scene = redo1;
  assert(scene.objects[0].transform.tx === 30, 'KB Ctrl+Y 1: move redone (tx=30)');

  const redo2 = history.redo()!;
  scene = redo2;
  assert(scene.objects.length === 2, 'KB Ctrl+Y 2: second rect restored');
}

// ─── TEST: IMPORT THEN DRAG THEN UNDO ────────────────────────────

console.log('\n=== Test: Import → Drag → Undo ===');

{
  const history = new HistoryManager();
  let scene = createScene(400, 300);
  const lid = scene.layers[0].id;
  history.push(scene);

  // Import SVG
  scene = importSvgIntoScene(testSvg, scene, lid, { mode: 'fit' });
  history.push(scene);
  assert(scene.objects.length === 2, 'IDU: 2 imported objects');

  const importedId = scene.objects[0].id;
  const origTx = scene.objects[0].transform.tx;

  // Simulate drag (multiple onSceneChange calls, one commit)
  let dragged = scene;
  for (let i = 0; i < 10; i++) {
    dragged = moveObjects(dragged, new Set([importedId]), 2, 1);
    // onSceneChange(dragged) — no history push
  }
  // onSceneCommit on mouseUp
  history.push(dragged);
  scene = dragged;

  assert(scene.objects[0].transform.tx !== origTx, 'IDU: object moved');
  assert(history.getState().totalSnapshots === 3, 'IDU: 3 snapshots (initial, import, drag)');

  // Undo drag
  scene = history.undo()!;
  assertClose(scene.objects[0].transform.tx, origTx, 0.001, 'IDU undo drag: original position restored');

  // Undo import
  scene = history.undo()!;
  assert(scene.objects.length === 0, 'IDU undo import: empty scene');

  // Redo import
  scene = history.redo()!;
  assert(scene.objects.length === 2, 'IDU redo import: objects back');

  // Redo drag
  scene = history.redo()!;
  assert(scene.objects[0].transform.tx !== origTx, 'IDU redo drag: moved position back');
}

// ─── TEST: SAVE AFTER IMPORT PRESERVES IMPORTED OBJECTS ──────────

console.log('\n=== Test: Save After Import ===');

{
  let scene = createScene(400, 300, 'ImportAndSave');
  const lid = scene.layers[0].id;

  // Import SVG
  scene = importSvgIntoScene(testSvg, scene, lid, { mode: 'original' });
  assert(scene.objects.length === 2, 'SaveImport: 2 objects');

  // Save and reload
  const json = serializeScene(scene);
  const reloaded = deserializeScene(json);

  assert(reloaded.objects.length === 2, 'SaveImport: 2 objects after reload');
  assert(reloaded.objects[0].geometry.type === 'rect', 'SaveImport: rect geometry survived');
  assert(reloaded.objects[1].geometry.type === 'ellipse', 'SaveImport: ellipse geometry survived');

  // Transform should survive
  assertClose(
    reloaded.objects[0].transform.tx,
    scene.objects[0].transform.tx,
    0.001,
    'SaveImport: transform.tx preserved'
  );
}

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
