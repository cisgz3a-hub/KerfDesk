/**
 * T3-31: self-intersecting closed geometry should warn before compile.
 * Run: npx tsx tests/preflight-self-intersection.test.ts
 */
import {
  PREFLIGHT_CODES,
  runPreflight,
  type PreflightContext,
} from '../src/core/preflight/Preflight';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createPolygon, type SceneObject } from '../src/core/scene/SceneObject';
import { defaultLaserSettings, type Layer } from '../src/core/scene/Layer';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function sceneWith(objects: SceneObject[]): Scene {
  const scene = createScene(300, 200, 'T3-31');
  const layer: Layer = {
    id: 'L1',
    name: 'Cut',
    color: '#f00',
    visible: true,
    locked: false,
    output: true,
    order: 0,
    settings: defaultLaserSettings('cut'),
  };
  scene.layers = [layer];
  scene.objects = objects.map(object => ({ ...object, layerId: 'L1' }));
  return scene;
}

function ctxFor(scene: Scene): PreflightContext {
  const profile = createBlankProfile('T3-31');
  profile.maxSpindle = 1000;
  return {
    scene,
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 200,
    connectedToMachine: false,
    hasGcode: false,
    machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    liveMachineInfo: {},
  };
}

function selfIntersectionWarnings(scene: Scene): string[] {
  return runPreflight(ctxFor(scene))
    .filter(result => result.code === PREFLIGHT_CODES.GEOMETRY_SELF_INTERSECTION)
    .map(result => result.message);
}

console.log('\n=== T3-31 self-intersection preflight ===\n');

{
  const bowTie = createPolygon('L1', [
    { x: 0, y: 0 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
    { x: 30, y: 0 },
  ], true, 'Bow tie');
  const warnings = selfIntersectionWarnings(sceneWith([bowTie]));
  assert(warnings.length === 1, `bow-tie polygon emits one warning (got ${warnings.length})`);
  assert(/self-intersect/i.test(warnings[0] ?? ''), 'warning names self-intersection');
  assert(/Bow tie/.test(warnings[0] ?? ''), 'warning names the object');
}

{
  const square = createPolygon('L1', [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
  ], true, 'Square');
  assert(selfIntersectionWarnings(sceneWith([square])).length === 0, 'simple closed polygon stays quiet');
}

{
  const openPolyline = createPolygon('L1', [
    { x: 0, y: 0 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
    { x: 30, y: 0 },
  ], false, 'Open line art');
  assert(selfIntersectionWarnings(sceneWith([openPolyline])).length === 0, 'open polygon/polyline stays quiet');
}

{
  const hidden = createPolygon('L1', [
    { x: 0, y: 0 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
    { x: 30, y: 0 },
  ], true, 'Hidden bow tie');
  hidden.visible = false;
  assert(selfIntersectionWarnings(sceneWith([hidden])).length === 0, 'hidden object stays quiet');
}

{
  const bowTie = createPolygon('L1', [
    { x: 0, y: 0 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
    { x: 30, y: 0 },
  ], true, 'Guide bow tie');
  const scene = sceneWith([bowTie]);
  scene.layers[0].output = false;
  assert(selfIntersectionWarnings(scene).length === 0, 'output:false layer stays quiet');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
