/**
 * F45-08-002: closed-polygon operations must not invent bridges for open paths.
 *
 * Run: npx tsx tests/open-path-boolean-offset-rejects.test.ts
 */
import { booleanOperation, objectToPolygon } from '../src/geometry/BooleanOps';
import { offsetObject } from '../src/geometry/OffsetPath';
import { createRect, type PathGeometry, type PolygonGeometry, type SceneObject, type SubPath } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
import { entitlementService } from '../src/entitlements';
import type { EntitlementState } from '../src/entitlements';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function setEntitlement(state: EntitlementState): void {
  (entitlementService as unknown as { state: EntitlementState }).state = state;
}

function sceneObject(type: SceneObject['type'], geometry: SceneObject['geometry']): SceneObject {
  return {
    id: generateId(),
    type,
    name: type,
    layerId: 'layer',
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function openRectangleSubPath(): SubPath {
  return {
    closed: false,
    segments: [
      { type: 'move', to: { x: 0, y: 0 } },
      { type: 'line', to: { x: 20, y: 0 } },
      { type: 'line', to: { x: 20, y: 20 } },
      { type: 'line', to: { x: 0, y: 20 } },
    ],
  };
}

function closedTriangleSubPath(): SubPath {
  return {
    closed: true,
    segments: [
      { type: 'move', to: { x: 0, y: 0 } },
      { type: 'line', to: { x: 20, y: 0 } },
      { type: 'line', to: { x: 20, y: 20 } },
      { type: 'close' },
    ],
  };
}

function pathObject(subPath: SubPath): SceneObject {
  const geometry: PathGeometry = { type: 'path', subPaths: [subPath] };
  return sceneObject('path', geometry);
}

function polygonObject(closed: boolean): SceneObject {
  const geometry: PolygonGeometry = {
    type: 'polygon',
    closed,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ],
  };
  return sceneObject('polygon', geometry);
}

console.log('\n=== F45-08-002 open paths rejected by closed geometry tools ===\n');

setEntitlement({ tier: 'paid', hasPro: true, features: ['boolean_ops'] });

const cutter = createRect('layer', 5, -5, 20, 30);
const openPath = pathObject(openRectangleSubPath());
const closedPath = pathObject(closedTriangleSubPath());
const openPolygon = polygonObject(false);
const closedPolygon = polygonObject(true);

assert(objectToPolygon(openPath) === null, 'open path does not convert to an implicit polygon');
assert(booleanOperation(openPath, cutter, 'union') === null, 'boolean operation rejects open path input');
assert(offsetObject(openPath, 2) === null, 'closed-path offset rejects open path input');

assert(objectToPolygon(openPolygon) === null, 'open polygon does not convert to an implicit closed polygon');
assert(booleanOperation(openPolygon, cutter, 'union') === null, 'boolean operation rejects open polygon input');
assert(offsetObject(openPolygon, 2) === null, 'closed-path offset rejects open polygon input');

assert(objectToPolygon(closedPath) !== null, 'closed path still converts to a polygon');
assert(booleanOperation(closedPath, cutter, 'union') !== null, 'boolean operation still accepts closed path input');
assert(offsetObject(closedPath, 2) !== null, 'closed-path offset still accepts closed path input');

assert(objectToPolygon(closedPolygon) !== null, 'closed polygon still converts to a polygon');
assert(booleanOperation(closedPolygon, cutter, 'union') !== null, 'boolean operation still accepts closed polygon input');
assert(offsetObject(closedPolygon, 2) !== null, 'closed-path offset still accepts closed polygon input');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
