/**
 * T3-39: malformed image inputs are rejected before unsafe raster compile.
 *
 * Run: npx tsx tests/malformed/bad-image.test.ts
 */
import { compileGcode } from '../../src/app/PipelineService';
import { createBlankProfile } from '../../src/core/devices/DeviceProfile';
import { PREFLIGHT_CODES, runPreflight, type PreflightContext } from '../../src/core/preflight/Preflight';
import { createLayer } from '../../src/core/scene/Layer';
import { createScene, type Scene } from '../../src/core/scene/Scene';
import type { ImageGeometry, SceneObject } from '../../src/core/scene/SceneObject';
import { generateId, IDENTITY_MATRIX } from '../../src/core/types';
import { validateImageGeometry } from '../../src/io/validation/geometryValidation';

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
  const p = createBlankProfile('T3-39 bad image');
  p.bedWidth = 300;
  p.bedHeight = 300;
  p.maxSpindle = 1000;
  p.originCorner = 'rear-left';
  return p;
}

function makeScene(geometry: ImageGeometry): Scene {
  const scene = createScene(300, 300, 'bad image');
  const layer = createLayer(0, 'image', 'Image');
  layer.settings.image.imageMode = 'grayscale';
  layer.settings.speed = 800;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const obj: SceneObject = {
    id: generateId(),
    type: 'image',
    name: 'Image',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 10, ty: 10 },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [obj];
  return scene;
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

async function main(): Promise<void> {
  console.log('\n=== T3-39 bad image ===\n');

  {
    const zero = validateImageGeometry({
      type: 'image',
      originalWidth: 0,
      originalHeight: 0,
      cropX: 0,
      cropY: 0,
      cropWidth: 0,
      cropHeight: 0,
    });
    assert(zero.issues.some(issue => issue.kind === 'invalid-image-dimensions'), 'zero-size image is invalid at load validation');
  }

  {
    const scene = makeScene({
      type: 'image',
      src: 'data:image/raw;base64,',
      originalWidth: 0,
      originalHeight: 0,
      cropX: 0,
      cropY: 0,
      cropWidth: 0,
      cropHeight: 0,
    });
    const issues = runPreflight(ctx(scene));
    assert(issues.some(i => i.code === PREFLIGHT_CODES.IMAGE_MISSING_RASTER), 'zero-size/no-data image blocks preflight');
    const compiled = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null, profile());
    assert(compiled === null, 'zero-size/no-data image produces no G-code output');
  }

  {
    const scene = makeScene({
      type: 'image',
      src: 'data:image/raw;base64,',
      originalWidth: 8000,
      originalHeight: 8000,
      cropX: 0,
      cropY: 0,
      cropWidth: 8000,
      cropHeight: 8000,
    });
    const issues = runPreflight(ctx(scene));
    assert(
      issues.some(i => i.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK && i.severity === 'error'),
      'huge image is blocked by compile-complexity preflight before allocation-heavy compile',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
