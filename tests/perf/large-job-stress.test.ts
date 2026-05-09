/**
 * T3-40: performance / stress guardrails for large jobs.
 *
 * Run: npx tsx tests/perf/large-job-stress.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileJob } from '../../src/core/job/JobCompiler';
import { createScene, type Scene } from '../../src/core/scene/Scene';
import { createLayer } from '../../src/core/scene/Layer';
import {
  estimateCompileComplexity,
  runCompileComplexityChecks,
} from '../../src/core/preflight/rules/CompileComplexityPreflight';
import {
  PREFLIGHT_CODES,
  type PreflightContext,
  type PreflightResult,
} from '../../src/core/preflight/Preflight';
import { flatPathFromPoints } from '../../src/core/job/Job';
import { generateFillRows } from '../../src/core/plan/FillGenerator';
import { optimizePlan } from '../../src/core/plan/PlanOptimizer';
import { GrblOutputStrategy } from '../../src/core/output/GrblStrategy';
import {
  type ImageGeometry,
  type PathGeometry,
  type PathSegment,
  type RectGeometry,
  type SceneObject,
} from '../../src/core/scene/SceneObject';
import { generateId, IDENTITY_MATRIX } from '../../src/core/types';

const PERF_BUDGET_MS = 12_000;
const MAX_SCANLINE_ROWS = 50_000;

function makePreflightContext(scene: Scene): PreflightContext {
  return {
    scene,
    profile: null,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: scene.canvas.width,
    preflightBedHeightMm: scene.canvas.height,
  };
}

function makeImageObject(
  layerId: string,
  width: number,
  height: number,
  data?: Uint8Array,
): SceneObject {
  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,stress',
    originalWidth: width,
    originalHeight: height,
    cropX: 0,
    cropY: 0,
    cropWidth: width,
    cropHeight: height,
    grayscaleWidth: width,
    grayscaleHeight: height,
    grayscaleData: data,
  };
  return {
    id: generateId(),
    type: 'image',
    name: 'stress-image',
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

function makePathObject(layerId: string, segments: number): SceneObject {
  const pathSegments: PathSegment[] = [{ type: 'move', to: { x: 0, y: 0 } }];
  for (let i = 1; i <= segments; i++) {
    pathSegments.push({
      type: 'line',
      to: {
        x: i % 250,
        y: Math.floor(i / 250) * 0.2 + (i % 2 === 0 ? 0 : 0.1),
      },
    });
  }
  const geom: PathGeometry = {
    type: 'path',
    subPaths: [{ segments: pathSegments, closed: false }],
  };
  return {
    id: generateId(),
    type: 'path',
    name: 'dense-vector',
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

function makeRectObject(layerId: string, x: number): SceneObject {
  const geom: RectGeometry = {
    type: 'rect',
    x,
    y: 10,
    width: 15,
    height: 10,
    cornerRadius: 0,
  };
  return {
    id: generateId(),
    type: 'rect',
    name: 'repeat-rect',
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

function makeCheckerboard(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = (x + y) % 2 === 0 ? 0 : 255;
    }
  }
  return data;
}

test('200x200mm grayscale raster is estimated and gated before allocating pixels', () => {
  const scene = createScene(400, 300, 'T3-40 large raster estimate');
  const layer = createLayer(0, 'image', 'Raster');
  layer.settings.image.imageMode = 'grayscale';
  layer.settings.image.resolution = 254;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;

  const object = makeImageObject(layer.id, 2000, 2000);
  scene.objects = [object];

  const estimate = estimateCompileComplexity(scene);
  assert.equal(estimate.rasterPixels, 4_000_000);
  assert.equal(estimate.expectedGcodeLineCount, 4_000_000);
  assert.ok(estimate.estimatedMemoryMB < 800, `memory estimate stayed bounded (${estimate.estimatedMemoryMB}MB)`);
  assert.equal(object.geometry.type, 'image');
  assert.equal(object.geometry.grayscaleData, undefined, 'preflight estimate does not need the full bitmap allocated');

  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makePreflightContext(scene), out);
  assert.equal(out.some(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK), false);
  assert.equal(out.some(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_WARN), true);
});

test('dithered checkerboard raster can be planned and cancelled during G-code output', () => {
  const scene = createScene(400, 300, 'T3-40 checkerboard');
  const layer = createLayer(0, 'image', 'Dither');
  layer.settings.image.imageMode = 'dither';
  layer.settings.image.dithering = 'threshold';
  layer.settings.image.imageThreshold = 128;
  layer.settings.speed = 3000;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makeImageObject(layer.id, 96, 96, makeCheckerboard(96, 96))];

  const estimate = estimateCompileComplexity(scene);
  assert.equal(estimate.expectedGcodeLineCount, 96 * 96);

  const job = compileJob(scene, { optimizeOrder: false });
  const plan = optimizePlan(job);
  assert.ok(plan.stats.moveCount > 100, `checkerboard produced enough moves for cancellation (${plan.stats.moveCount})`);

  const ac = new AbortController();
  const events: number[] = [];
  const strategy = new GrblOutputStrategy();
  assert.throws(
    () => strategy.generate(plan, job, {
      startMode: 'absolute',
      maxSpindle: 1000,
      returnPosition: null,
      signal: ac.signal,
      onProgress: event => {
        events.push(event.completedMoves);
        if (event.completedMoves >= 5) ac.abort();
      },
    }),
    error => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.ok(events.length > 0 && events.length < plan.stats.moveCount);
});

test('dense 50,000-segment vector compiles deterministically without O(n^2)-style collapse', () => {
  const scene = createScene(400, 300, 'T3-40 dense vector');
  const layer = createLayer(0, 'cut', 'Cut');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makePathObject(layer.id, 50_000)];

  const t0 = performance.now();
  const firstJob = compileJob(scene);
  const firstPlan = optimizePlan(firstJob);
  const firstElapsed = performance.now() - t0;

  const secondJob = compileJob(scene);
  const secondPlan = optimizePlan(secondJob);

  assert.ok(firstElapsed < PERF_BUDGET_MS, `dense vector completed in ${firstElapsed.toFixed(0)}ms`);
  assert.equal(firstJob.operations.length, secondJob.operations.length);
  assert.equal(firstPlan.stats.moveCount, secondPlan.stats.moveCount);
  assert.equal(firstPlan.operations[0]?.moves.length, secondPlan.operations[0]?.moves.length);
  assert.ok(firstPlan.stats.moveCount >= 50_000, `planned moves include the dense path (${firstPlan.stats.moveCount})`);
});

test('dense hatch fill is clamped to a bounded scanline count and does not freeze', () => {
  const square = flatPathFromPoints([
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ], true, 'dense-fill-square');

  const t0 = performance.now();
  const rows = generateFillRows([square], {
    interval: 0.001,
    angle: 0,
    biDirectional: true,
    overscanning: 0,
  });
  const elapsed = performance.now() - t0;

  assert.ok(rows.length > 0, 'dense fill still produces rows');
  assert.ok(rows.length <= MAX_SCANLINE_ROWS, `dense fill rows stay capped (${rows.length})`);
  assert.ok(elapsed < PERF_BUDGET_MS, `dense fill completed in ${elapsed.toFixed(0)}ms`);
});

test('20 repeated edit/export cycles stay bounded', () => {
  const gc = (globalThis as unknown as { gc?: () => void }).gc;
  gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let maxOutputBytes = 0;
  let minLineCount = Infinity;
  let maxLineCount = 0;

  for (let i = 0; i < 20; i++) {
    const scene = createScene(400, 300, `T3-40 repeat ${i}`);
    const layer = createLayer(0, 'cut', 'Cut');
    scene.layers = [layer];
    scene.activeLayerId = layer.id;
    scene.objects = [makeRectObject(layer.id, 10 + i)];

    const job = compileJob(scene);
    const plan = optimizePlan(job);
    const output = new GrblOutputStrategy().generate(plan, job, {
      startMode: 'absolute',
      maxSpindle: 1000,
      returnPosition: null,
      clock: () => '2026-05-09T00:00:00.000Z',
    });

    maxOutputBytes = Math.max(maxOutputBytes, output.fileSizeBytes);
    minLineCount = Math.min(minLineCount, output.lineCount);
    maxLineCount = Math.max(maxLineCount, output.lineCount);
  }

  gc?.();
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMb = (heapAfter - heapBefore) / (1024 * 1024);

  assert.ok(maxOutputBytes < 50_000, `small repeated exports remain small (${maxOutputBytes} bytes)`);
  assert.ok(maxLineCount - minLineCount <= 2, `line counts stay stable (${minLineCount}-${maxLineCount})`);
  assert.ok(heapDeltaMb < 128, `heap growth stays bounded (${heapDeltaMb.toFixed(1)}MB)`);
});
