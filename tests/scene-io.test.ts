/**
 * === FILE: /tests/scene-io.test.ts ===
 *
 * Purpose:    Tests for Scene serialization and deserialization.
 *             Verifies roundtrip fidelity, transient state stripping,
 *             ID preservation, error handling, and complex scene integrity.
 *
 * Run with: npx tsx tests/scene-io.test.ts
 */

import { serializeScene, deserializeScene } from '../src/io/SceneSerializer';
import { createScene } from '../src/core/scene/Scene';
import { createRect, createEllipse, createLine } from '../src/core/scene/SceneObject';
import { createLayer } from '../src/core/scene/Layer';
import { type Matrix3x2 } from '../src/core/types';
import { addObject, addObjects, addLayer } from '../src/ui/history/SceneCommands';

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
  assert(Math.abs(actual - expected) < tol, `${msg} (got ${actual}, expected ${expected})`);
}

function assertThrows(fn: () => void, expectedMsg: string, label: string): void {
  try {
    fn();
    assert(false, `${label}: should have thrown`);
  } catch (e: any) {
    assert(e.message.includes(expectedMsg), `${label}: error contains '${expectedMsg}' (got '${e.message}')`);
  }
}

// ─── TEST: BASIC ROUNDTRIP ──────────────────────────────────────

console.log('\n=== Test: Basic Roundtrip ===');

const scene1 = createScene(400, 300, 'Test Project');
const lid1 = scene1.layers[0].id;

const json1 = serializeScene(scene1);
const restored1 = deserializeScene(json1);

assert(restored1.id === scene1.id, 'Roundtrip: scene ID preserved');
assert(restored1.version === '1.0', 'Roundtrip: version preserved');
assert(restored1.canvas.width === 400, 'Roundtrip: canvas width preserved');
assert(restored1.canvas.height === 300, 'Roundtrip: canvas height preserved');
assert(restored1.metadata.name === 'Test Project', 'Roundtrip: name preserved');
assert(restored1.layers.length === 1, 'Roundtrip: 1 layer');
assert(restored1.layers[0].id === lid1, 'Roundtrip: layer ID preserved');
assert(restored1.objects.length === 0, 'Roundtrip: 0 objects');

// ─── TEST: SELECTION STRIPPED ────────────────────────────────────

console.log('\n=== Test: Selection Stripped ===');

const sceneWithSel = {
  ...scene1,
  selection: ['fake-id-1', 'fake-id-2'],
};

const jsonSel = serializeScene(sceneWithSel);
const restoredSel = deserializeScene(jsonSel);

assert(restoredSel.selection.length === 0, 'Selection stripped: empty after roundtrip');

// Verify selection is not in the JSON string at all
const parsedJson = JSON.parse(jsonSel);
assert(parsedJson.scene.selection === undefined, 'Selection stripped: not present in JSON');

// ─── TEST: CACHE FIELDS STRIPPED ─────────────────────────────────

console.log('\n=== Test: Cache Fields Stripped ===');

const rect1 = createRect(lid1, 10, 20, 50, 30, 'CachedRect');
const sceneWithCache = addObject(scene1, {
  ...rect1,
  _bounds: { minX: 10, minY: 20, maxX: 60, maxY: 50 },
  _worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
});

const jsonCache = serializeScene(sceneWithCache);
const parsedCache = JSON.parse(jsonCache);

// Cache fields should not appear in the JSON
assert(parsedCache.scene.objects[0]._bounds === undefined, 'Cache: _bounds not in JSON');
assert(parsedCache.scene.objects[0]._worldTransform === undefined, 'Cache: _worldTransform not in JSON');

// After deserialize, caches should be null
const restoredCache = deserializeScene(jsonCache);
assert(restoredCache.objects[0]._bounds === null, 'Cache: _bounds = null after load');
assert(restoredCache.objects[0]._worldTransform === null, 'Cache: _worldTransform = null after load');

// ─── TEST: ID PRESERVATION ───────────────────────────────────────

console.log('\n=== Test: ID Preservation ===');

const sceneWithObj = addObject(scene1, createRect(lid1, 0, 0, 100, 100, 'IdTest'));
const origObjId = sceneWithObj.objects[0].id;
const origLayerId = sceneWithObj.layers[0].id;
const origSceneId = sceneWithObj.id;

const jsonIds = serializeScene(sceneWithObj);
const restoredIds = deserializeScene(jsonIds);

assert(restoredIds.id === origSceneId, 'IDs: scene ID preserved exactly');
assert(restoredIds.layers[0].id === origLayerId, 'IDs: layer ID preserved exactly');
assert(restoredIds.objects[0].id === origObjId, 'IDs: object ID preserved exactly');

// ─── TEST: OBJECT GEOMETRY INTEGRITY ─────────────────────────────

console.log('\n=== Test: Object Geometry Integrity ===');

const rectObj = createRect(lid1, 15.5, 25.3, 100.7, 50.2, 'PreciseRect');
const ellipseObj = createEllipse(lid1, 200, 150, 40.5, 30.1, 'PreciseEllipse');
const lineObj = createLine(lid1, 10, 20, 300.9, 250.7, 'PreciseLine');

const geomScene = addObjects(scene1, [rectObj, ellipseObj, lineObj]);
const geomJson = serializeScene(geomScene);
const geomRestored = deserializeScene(geomJson);

assert(geomRestored.objects.length === 3, 'Geometry: 3 objects');

// Rect
const rr = geomRestored.objects[0];
assert(rr.geometry.type === 'rect', 'Geometry: rect type');
if (rr.geometry.type === 'rect') {
  assertClose(rr.geometry.x, 0, 0.001, 'Geometry: rect local x = 0');
  assertClose(rr.geometry.width, 100.7, 0.001, 'Geometry: rect width');
}
assertClose(rr.transform.tx, 15.5, 0.001, 'Geometry: rect position in transform tx');

// Ellipse
const re = geomRestored.objects[1];
assert(re.geometry.type === 'ellipse', 'Geometry: ellipse type');
if (re.geometry.type === 'ellipse') {
  assertClose(re.geometry.rx, 40.5, 0.001, 'Geometry: ellipse rx');
  assertClose(re.geometry.ry, 30.1, 0.001, 'Geometry: ellipse ry');
}

// Line
const rl = geomRestored.objects[2];
assert(rl.geometry.type === 'line', 'Geometry: line type');
if (rl.geometry.type === 'line') {
  assertClose(rl.geometry.x2, 300.9, 0.001, 'Geometry: line x2');
}

// ─── TEST: TRANSFORM INTEGRITY ───────────────────────────────────

console.log('\n=== Test: Transform Integrity ===');

const customTransform: Matrix3x2 = {
  a: 0.5, b: 0.866, c: -0.866, d: 0.5, tx: 120.5, ty: 80.3,
};

const transformedObj = {
  ...createRect(lid1, 0, 0, 50, 50, 'Transformed'),
  transform: customTransform,
};
const transformScene = addObject(scene1, transformedObj);
const transformJson = serializeScene(transformScene);
const transformRestored = deserializeScene(transformJson);

const rt = transformRestored.objects[0].transform;
assertClose(rt.a, 0.5, 0.0001, 'Transform: a preserved');
assertClose(rt.b, 0.866, 0.0001, 'Transform: b preserved');
assertClose(rt.c, -0.866, 0.0001, 'Transform: c preserved');
assertClose(rt.d, 0.5, 0.0001, 'Transform: d preserved');
assertClose(rt.tx, 120.5, 0.0001, 'Transform: tx preserved');
assertClose(rt.ty, 80.3, 0.0001, 'Transform: ty preserved');

// ─── TEST: LAYER SETTINGS INTEGRITY ──────────────────────────────

console.log('\n=== Test: Layer Settings Integrity ===');

const engraveLayer = createLayer(1, 'engrave', 'Engrave');
const layerScene = addLayer(scene1, {
  ...engraveLayer,
  settings: {
    ...engraveLayer.settings,
    power: 65,
    speed: 200,
    passes: 3,
  } as unknown as typeof engraveLayer.settings,
});

const layerJson = serializeScene(layerScene);
const layerRestored = deserializeScene(layerJson);

assert(layerRestored.layers.length === 2, 'Layer: 2 layers');

const restoredEngrave = layerRestored.layers[1];
assert(restoredEngrave.name === 'Engrave', 'Layer: name preserved');
assert(restoredEngrave.settings.mode === 'engrave', 'Layer: mode preserved');
assert(restoredEngrave.settings.power.max === 65, 'Layer: legacy numeric power → power.max');
assert(restoredEngrave.settings.power.min === 0, 'Layer: legacy numeric power → power.min');
assert(restoredEngrave.settings.speed === 200, 'Layer: speed preserved');
assert(restoredEngrave.settings.passes === 3, 'Layer: passes preserved');

// ─── TEST: INVALID JSON ─────────────────────────────────────────

console.log('\n=== Test: Invalid JSON ===');

assertThrows(
  () => deserializeScene('not json at all'),
  'Invalid JSON', 'Bad JSON'
);

assertThrows(
  () => deserializeScene('42'),
  'expected a JSON object', 'Primitive JSON'
);

assertThrows(
  () => deserializeScene('{"format":"unknown"}'),
  'Unknown file format', 'Wrong format'
);

assertThrows(
  () => deserializeScene('{"format":"laserforge","version":"2.0"}'),
  'not supported by this version', 'Wrong major version'
);

// ─── TEST: ENVELOPE VERSION 1.x (best-effort) ────────────────────

console.log('\n=== Test: Envelope version 1.x forward compatibility ===');

const minimalBase = {
  format: 'laserforge',
  version: '1.0',
  scene: {
    id: 'fwd-scene',
    canvas: { width: 100, height: 100 },
    layers: [{ id: 'L1', settings: { mode: 'cut', power: 80, speed: 300, passes: 1, interval: 0.1, angle: 0, dpi: 254, powerMin: 0, airAssist: false, zOffset: 0 } }],
    objects: [{
      id: 'o1',
      layerId: 'L1',
      geometry: { type: 'rect', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    }],
  },
};

const fwd11 = { ...minimalBase, version: '1.1' };
const loaded11 = deserializeScene(JSON.stringify(fwd11));
assert(loaded11.id === 'fwd-scene', 'Envelope 1.1: scene loads');

const noEnvVer = JSON.parse(JSON.stringify(minimalBase)) as typeof minimalBase;
delete noEnvVer.version;
const loadedNo = deserializeScene(JSON.stringify(noEnvVer));
assert(loadedNo.id === 'fwd-scene', 'Missing envelope version: treated as major 1');

assertThrows(
  () => deserializeScene('{"format":"laserforge","version":"1.0"}'),
  'missing scene data', 'Missing scene'
);

assertThrows(
  () => deserializeScene('{"format":"laserforge","version":"1.0","scene":{}}'),
  'missing required field', 'Empty scene'
);

// ─── TEST: PARTIAL / MISSING FIELDS ──────────────────────────────

console.log('\n=== Test: Partial / Missing Fields ===');

// Missing layers array
assertThrows(
  () => deserializeScene(JSON.stringify({
    format: 'laserforge', version: '1.0',
    scene: { id: 'test', canvas: { width: 400, height: 300 }, objects: [] },
  })),
  'must be an array', 'Missing layers'
);

// Empty layers array
assertThrows(
  () => deserializeScene(JSON.stringify({
    format: 'laserforge', version: '1.0',
    scene: { id: 'test', canvas: { width: 400, height: 300 }, layers: [], objects: [] },
  })),
  'at least one layer', 'Empty layers'
);

// ─── TEST: TOLERANT LOADING (optional fields) ────────────────────

console.log('\n=== Test: Tolerant Loading ===');

// Minimal valid file — many optional fields missing
const minimal = JSON.stringify({
  format: 'laserforge', version: '1.0',
  scene: {
    id: 'min-scene',
    canvas: { width: 200, height: 150 },
    layers: [{ id: 'layer-1', settings: { mode: 'cut', power: 80, speed: 300, passes: 1, interval: 0.1, angle: 0, dpi: 254, powerMin: 0, airAssist: false, zOffset: 0 } }],
    objects: [{
      id: 'obj-1',
      geometry: { type: 'rect', x: 0, y: 0, width: 50, height: 50, cornerRadius: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    }],
  },
});

const minScene = deserializeScene(minimal);
assert(minScene.id === 'min-scene', 'Tolerant: scene ID');
assert(minScene.canvas.width === 200, 'Tolerant: canvas width');
assert(minScene.layers[0].name === 'Layer', 'Tolerant: layer name defaulted');
assert(minScene.layers[0].visible === true, 'Tolerant: layer visible defaulted true');
assert(minScene.objects[0].visible === true, 'Tolerant: object visible defaulted true');
assert(minScene.objects[0].name === '', 'Tolerant: object name defaulted empty');
assert(minScene.selection.length === 0, 'Tolerant: selection empty');
assert(minScene.metadata.name === 'Untitled', 'Tolerant: metadata name defaulted');
assert(minScene.activeLayerId === 'layer-1', 'Tolerant: activeLayerId defaulted to first layer');

// ─── TEST: COMPLEX SCENE ROUNDTRIP ───────────────────────────────

console.log('\n=== Test: Complex Scene Roundtrip ===');

let complex = createScene(500, 400, 'Complex Project');
const complexLid = complex.layers[0].id;

// Add multiple layers
const cutLayer = complex.layers[0];
const engraveLayer2 = createLayer(1, 'engrave', 'Engrave Layer');
const scoreLayer = createLayer(2, 'score', 'Score Layer');
complex = addLayer(complex, engraveLayer2);
complex = addLayer(complex, scoreLayer);

// Add objects with various geometries and transforms
const objects = [
  createRect(complexLid, 10, 10, 100, 50, 'Box'),
  createEllipse(complexLid, 200, 100, 40, 30, 'Oval'),
  createLine(complexLid, 0, 0, 500, 400, 'Diagonal'),
  {
    ...createRect(engraveLayer2.id, 50, 50, 80, 80, 'RotatedBox'),
    transform: { a: 0.707, b: 0.707, c: -0.707, d: 0.707, tx: 150, ty: 200 } as Matrix3x2,
  },
  createEllipse(scoreLayer.id, 400, 300, 20, 20, 'ScoreCircle'),
];

complex = addObjects(complex, objects);

// Set non-default metadata
complex = {
  ...complex,
  metadata: {
    ...complex.metadata,
    author: 'Test Author',
    notes: 'Testing complex roundtrip with special chars: <>&"\'',
    deviceProfileId: 'k40-co2',
    materialPresetId: '3mm-plywood',
  },
  selection: ['should-be-stripped'],
};

// Serialize and deserialize
const complexJson = serializeScene(complex);
const complexRestored = deserializeScene(complexJson);

assert(complexRestored.layers.length === 3, 'Complex: 3 layers');
assert(complexRestored.objects.length === 5, 'Complex: 5 objects');
assert(complexRestored.selection.length === 0, 'Complex: selection stripped');
assert(complexRestored.metadata.author === 'Test Author', 'Complex: author preserved');
assert(complexRestored.metadata.notes.includes('<>&'), 'Complex: special chars preserved');
assert(complexRestored.metadata.deviceProfileId === 'k40-co2', 'Complex: device profile preserved');

// Verify objects on correct layers
const engraveObjs = complexRestored.objects.filter(o => o.layerId === engraveLayer2.id);
assert(engraveObjs.length === 1, 'Complex: 1 object on engrave layer');
assert(engraveObjs[0].name === 'RotatedBox', 'Complex: correct object on engrave layer');

// Verify rotated transform survived
const rotObj = engraveObjs[0];
assertClose(rotObj.transform.a, 0.707, 0.001, 'Complex: rotation a preserved');
assertClose(rotObj.transform.tx, 150, 0.001, 'Complex: rotation tx preserved');

// ─── TEST: FILE FORMAT STRUCTURE ─────────────────────────────────

console.log('\n=== Test: File Format Structure ===');

const formatJson = JSON.parse(serializeScene(scene1));
assert(formatJson.format === 'laserforge', 'Format: envelope has format field');
assert(formatJson.version === '1.0', 'Format: envelope has version field');
assert(typeof formatJson.scene === 'object', 'Format: envelope has scene field');
assert(formatJson.scene.id === scene1.id, 'Format: scene.id present');

// ─── TEST: APP VERSION IN FILE ────────────────────────────────────

console.log('\n=== Test: App Version ===');

const versionJson = JSON.parse(serializeScene(scene1));
assert(typeof versionJson.appVersion === 'string', 'appVersion: present in file');
assert(versionJson.appVersion.length > 0, 'appVersion: non-empty');
assert(versionJson.version === '1.0', 'version: file format version still 1.0');

// ─── TEST: NaN / INFINITY TRANSFORM REJECTION ────────────────────

console.log('\n=== Test: NaN / Infinity Transform Rejection ===');

const nanScene = JSON.stringify({
  format: 'laserforge', version: '1.0',
  scene: {
    id: 'nan-test', canvas: { width: 400, height: 300 },
    layers: [{ id: 'l1', settings: { mode: 'cut', power: 80, speed: 300, passes: 1, interval: 0.1, angle: 0, dpi: 254, powerMin: 0, airAssist: false, zOffset: 0 } }],
    objects: [{
      id: 'obj-nan',
      geometry: { type: 'rect', x: 0, y: 0, width: 50, height: 50, cornerRadius: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1, tx: NaN, ty: 0 },
    }],
  },
});

assertThrows(
  () => deserializeScene(nanScene),
  'not a finite number', 'NaN in transform'
);

const infScene = nanScene.replace('null', 'Infinity').replace('"tx":null', '"tx":Infinity');
// Build a clean Infinity case
const infSceneJson = JSON.stringify({
  format: 'laserforge', version: '1.0',
  scene: {
    id: 'inf-test', canvas: { width: 400, height: 300 },
    layers: [{ id: 'l1', settings: { mode: 'cut', power: 80, speed: 300, passes: 1, interval: 0.1, angle: 0, dpi: 254, powerMin: 0, airAssist: false, zOffset: 0 } }],
    objects: [{
      id: 'obj-inf',
      geometry: { type: 'rect', x: 0, y: 0, width: 50, height: 50, cornerRadius: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 999, ty: 0 },
    }],
  },
});
// Manually inject Infinity (JSON.stringify converts it to null)
const infModified = infSceneJson.replace('"tx":999', '"tx":null');
assertThrows(
  () => deserializeScene(infModified),
  'not a finite number', 'null (from Infinity) in transform'
);

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
