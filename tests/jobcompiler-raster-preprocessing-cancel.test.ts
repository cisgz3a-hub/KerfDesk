/**
 * S40-03-001: raster preprocessing must observe cancellation inside large
 * per-pixel image work, not only at compile object boundaries.
 *
 * Run: npx tsx tests/jobcompiler-raster-preprocessing-cancel.test.ts
 */
import { compileJob } from '../src/core/job/JobCompiler';
import { createLayer } from '../src/core/scene/Layer';
import { createScene } from '../src/core/scene/Scene';
import type { ImageGeometry, SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function makeAbortSignalAfterReads(readLimit: number): AbortSignal {
  let reads = 0;
  return {
    get aborted(): boolean {
      reads++;
      return reads >= readLimit;
    },
  } as AbortSignal;
}

function makeRasterScene(width: number, height: number): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'S40-03 raster cancel');
  const layer = createLayer(0, 'image', 'Raster');
  layer.settings.image.imageMode = 'dither';
  layer.settings.image.dithering = 'floyd-steinberg';
  layer.settings.image.brightness = 20;
  layer.settings.image.contrast = 15;
  layer.settings.image.gamma = 1.6;
  layer.settings.image.invert = true;
  layer.settings.speed = 6000;
  layer.settings.power = { min: 10, max: 70 };
  scene.layers = [layer];
  scene.activeLayerId = layer.id;

  const grayscaleData = new Uint8Array(width * height);
  for (let i = 0; i < grayscaleData.length; i++) {
    grayscaleData[i] = (i * 37 + 19) & 0xff;
  }

  const geometry: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,iVBORw0KGgo=',
    originalWidth: width,
    originalHeight: height,
    cropX: 0,
    cropY: 0,
    cropWidth: width,
    cropHeight: height,
    grayscaleData,
    grayscaleWidth: width,
    grayscaleHeight: height,
  };

  const object: SceneObject = {
    id: generateId(),
    type: 'image',
    name: 'large-raster',
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
  scene.objects = [object];
  return scene;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

console.log('\n=== S40-03-001 raster preprocessing cancellation ===\n');

// The old implementation checked only the high-level compile boundaries. This
// signal flips after many aborted reads, so boundary-only cancellation lets the
// whole image compile. A fixed implementation must checkpoint inside the raster
// preprocessing/dithering loops and throw AbortError before producing the job.
{
  let threw: unknown = null;
  try {
    compileJob(makeRasterScene(160, 160), {
      signal: makeAbortSignalAfterReads(40),
      machineAccelMmPerS2: 1000,
      strategySupportsDynamicLaserPower: false,
      optimizeOrder: false,
    });
  } catch (err) {
    threw = err;
  }
  assert(isAbortError(threw), `large raster preprocessing aborts cooperatively (got ${(threw as Error | null)?.name ?? 'no throw'})`);
}

// A normal non-cancelled raster compile still succeeds; this guards against
// converting cancellation checkpoints into unconditional failures.
{
  const job = compileJob(makeRasterScene(16, 16), {
    machineAccelMmPerS2: 1000,
    strategySupportsDynamicLaserPower: false,
    optimizeOrder: false,
  });
  const raster = job.operations.find(op => op.geometry.type === 'raster');
  assert(raster != null, 'non-cancelled raster compile still produces a raster operation');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
