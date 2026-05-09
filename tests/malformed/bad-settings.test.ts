/**
 * T3-39: impossible layer settings are blocked or sanitized.
 *
 * Run: npx tsx tests/malformed/bad-settings.test.ts
 */
import { compileGcode } from '../../src/app/PipelineService';
import { createBlankProfile } from '../../src/core/devices/DeviceProfile';
import { PREFLIGHT_CODES, runPreflight, type PreflightContext } from '../../src/core/preflight/Preflight';
import { createLayer } from '../../src/core/scene/Layer';
import { createScene, type Scene } from '../../src/core/scene/Scene';
import { createRect, type ImageGeometry, type SceneObject } from '../../src/core/scene/SceneObject';
import { generateId, IDENTITY_MATRIX } from '../../src/core/types';
import { parseGcode } from '../helpers/parseGcode';

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

function profile() {
  const p = createBlankProfile('T3-39 bad settings');
  p.bedWidth = 300;
  p.bedHeight = 300;
  p.maxSpindle = 1000;
  p.originCorner = 'rear-left';
  return p;
}

function ctx(scene: Scene): PreflightContext {
  return {
    scene,
    profile: profile(),
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
  };
}

function rectScene(mode: 'cut' | 'engrave' = 'cut'): Scene {
  const scene = createScene(300, 300, `T3-39 ${mode}`);
  scene.compileOptions = { optimizeOrder: false };
  const layer = mode === 'cut' ? scene.layers[0] : createLayer(0, 'engrave', 'Engrave');
  layer.settings.mode = mode;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [createRect(layer.id, 20, 20, 30, 20, 'Rect')];
  return scene;
}

function imageObject(layerId: string): SceneObject {
  const geometry: ImageGeometry = {
    type: 'image',
    src: 'data:image/raw;base64,AA==',
    originalWidth: 2,
    originalHeight: 2,
    cropX: 0,
    cropY: 0,
    cropWidth: 2,
    cropHeight: 2,
    grayscaleData: new Uint8Array([0, 64, 128, 255]),
    grayscaleWidth: 2,
    grayscaleHeight: 2,
  };
  return {
    id: generateId(),
    type: 'image',
    name: 'Image',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 10, ty: 10 },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

async function assertCompiledSafe(scene: Scene, label: string): Promise<void> {
  const compiled = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null, profile());
  assert(compiled != null, `${label}: compile produces output`);
  if (!compiled) return;
  const parsed = parseGcode(compiled.gcode);
  assert(parsed.asserts.noNaN, `${label}: output has no NaN`);
  assert(parsed.asserts.noInfinity, `${label}: output has no Infinity`);
  assert(parsed.asserts.feedAlwaysPositive, `${label}: burn feeds stay positive`);
}

async function main(): Promise<void> {
  console.log('\n=== T3-39 bad settings ===\n');

  {
    const scene = rectScene('cut');
    scene.layers[0].settings.speed = 0;
    const issues = runPreflight(ctx(scene));
    assert(issues.some(i => i.code === PREFLIGHT_CODES.LAYER_SPEED_ZERO), 'zero speed is a blocking preflight issue');
    await assertCompiledSafe(scene, 'zero speed fallback');
  }

  {
    const scene = rectScene('cut');
    scene.layers[0].settings.speed = Number.NaN;
    const issues = runPreflight(ctx(scene));
    assert(issues.some(i => i.code === PREFLIGHT_CODES.LAYER_SPEED_INVALID), 'NaN speed is a blocking preflight issue');
    await assertCompiledSafe(scene, 'NaN speed fallback');
  }

  {
    const scene = rectScene('cut');
    scene.layers[0].settings.power.min = 90;
    scene.layers[0].settings.power.max = 10;
    const issues = runPreflight(ctx(scene));
    assert(issues.some(i => i.code === PREFLIGHT_CODES.LAYER_POWER_RANGE_INVALID), 'power min greater than max is blocked');
    await assertCompiledSafe(scene, 'inverted power range fallback');
  }

  {
    const scene = rectScene('engrave');
    scene.layers[0].settings.fill.interval = 0;
    scene.layers[0].settings.smartOverscanEnabled = false;
    scene.layers[0].settings.fill.overscanning = -5;
    await assertCompiledSafe(scene, 'zero fill interval and negative overscan fallback');
  }

  {
    const scene = createScene(300, 300, 'invalid DPI');
    const layer = createLayer(0, 'image', 'Image');
    layer.settings.image.resolution = Number.NaN;
    layer.settings.image.imageMode = 'grayscale';
    layer.settings.speed = 800;
    scene.layers = [layer];
    scene.activeLayerId = layer.id;
    scene.objects = [imageObject(layer.id)];
    await assertCompiledSafe(scene, 'invalid image DPI fallback');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
