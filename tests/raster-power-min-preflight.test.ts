/**
 * T3-23: warn when grayscale/photo raster has powerMin > 0.
 * Run: npx tsx tests/raster-power-min-preflight.test.ts
 */
import { runPreflightSummary, PREFLIGHT_CODES } from '../src/core/preflight/Preflight';
import { createLayer, type ImageRasterMode } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { type ImageGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import type { MachineState } from '../src/controllers/ControllerInterface';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeImageObject(layerId: string): SceneObject {
  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: 10,
    originalHeight: 10,
    cropX: 0,
    cropY: 0,
    cropWidth: 10,
    cropHeight: 10,
    grayscaleData: new Uint8Array(100),
    grayscaleWidth: 10,
    grayscaleHeight: 10,
  };
  return {
    id: generateId(),
    type: 'image',
    name: 'photo',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function makeScene(opts: {
  imageMode: ImageRasterMode;
  powerMin: number;
  layerVisible?: boolean;
  layerOutput?: boolean;
  objectVisible?: boolean;
}): Scene {
  const scene = createScene(400, 300, 'Power min warning');
  const layer = createLayer(0, 'image', 'Photo');
  layer.settings.image.imageMode = opts.imageMode;
  layer.settings.power.min = opts.powerMin;
  layer.settings.power.max = 80;
  layer.visible = opts.layerVisible ?? true;
  layer.output = opts.layerOutput ?? true;
  const image = makeImageObject(layer.id);
  image.visible = opts.objectVisible ?? true;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [image];
  return scene;
}

function run(scene: Scene) {
  return runPreflightSummary(
    scene,
    'G0 X0 Y0\nM5 S0',
    idle,
    400,
    300,
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    undefined,
    undefined,
    1000,
  );
}

function powerMinIssue(scene: Scene) {
  return run(scene).issues.find(issue => issue.id === PREFLIGHT_CODES.IMAGE_POWER_MIN_MARKS_WHITE);
}

console.log('\n=== raster powerMin preflight ===\n');

{
  const scene = makeScene({ imageMode: 'grayscale', powerMin: 5 });
  const summary = run(scene);
  const issue = summary.issues.find(i => i.id === PREFLIGHT_CODES.IMAGE_POWER_MIN_MARKS_WHITE);
  assert(issue?.severity === 'warning', 'grayscale image with powerMin > 0 warns');
  assert(issue?.detail.includes('White areas will receive 5% laser power') === true, 'warning names white-area burn risk');
  assert(issue?.detail.includes('set minimum power to 0') === true, 'warning gives the action');
  assert(summary.canStart === true, 'warning does not block start');
}

{
  assert(!powerMinIssue(makeScene({ imageMode: 'grayscale', powerMin: 0 })), 'powerMin = 0 stays quiet');
  assert(!powerMinIssue(makeScene({ imageMode: 'threshold', powerMin: 5 })), 'threshold image mode stays quiet');
  assert(!powerMinIssue(makeScene({ imageMode: 'dither', powerMin: 5 })), 'dither image mode stays quiet');
  assert(!powerMinIssue(makeScene({ imageMode: 'grayscale', powerMin: 5, layerVisible: false })), 'hidden layer stays quiet');
  assert(!powerMinIssue(makeScene({ imageMode: 'grayscale', powerMin: 5, layerOutput: false })), 'output-disabled layer stays quiet');
  assert(!powerMinIssue(makeScene({ imageMode: 'grayscale', powerMin: 5, objectVisible: false })), 'hidden image object stays quiet');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
