/**
 * T1-45: compile complexity gate fires the right severity for the
 * estimated workload. Pre-T1-45 the user clicked compile on a 4MP
 * grayscale photo and the renderer froze for tens of seconds with no
 * progress indicator; the gate is the cheap defense that estimates
 * upper-bound complexity before launching the work and surfaces
 * info / warning / blocker so the user sees the cost up front.
 *
 * Run: npx tsx tests/compile-complexity-gate.test.ts
 */
import {
  estimateCompileComplexity,
  runCompileComplexityChecks,
} from '../src/core/preflight/rules/CompileComplexityPreflight';
import {
  PREFLIGHT_CODES,
  type PreflightContext,
  type PreflightResult,
} from '../src/core/preflight/Preflight';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import {
  type ImageGeometry,
  type RectGeometry,
  type SceneObject,
} from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function makeImageObject(layerId: string, gw: number, gh: number): SceneObject {
  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: gw,
    originalHeight: gh,
    cropX: 0,
    cropY: 0,
    cropWidth: gw,
    cropHeight: gh,
    grayscaleData: new Uint8Array(gw * gh),
    grayscaleWidth: gw,
    grayscaleHeight: gh,
  };
  return {
    id: generateId(),
    type: 'image',
    name: 'img',
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

function makeRectObject(layerId: string, w: number, h: number): SceneObject {
  const geom: RectGeometry = { type: 'rect', x: 0, y: 0, width: w, height: h, cornerRadius: 0 };
  return {
    id: generateId(),
    type: 'rect',
    name: 'r',
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

function makeCtx(scene: ReturnType<typeof createScene>): PreflightContext {
  return {
    scene,
    profile: null,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 400,
    preflightBedHeightMm: 300,
  };
}

console.log('\n=== T1-45 compile complexity gate ===\n');

void (async () => {

// 1. Empty scene → no estimate, no result
{
  const scene = createScene(400, 300, 'Empty');
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  assert(out.length === 0, `empty scene: no preflight result (got ${out.length})`);
}

// 2. Single small vector cut → no warning
{
  const scene = createScene(400, 300, 'Small');
  const layer = createLayer(0, 'cut', 'Cut');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makeRectObject(layer.id, 100, 100)];
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  assert(out.length === 0, `small vector: no preflight result (got ${out.length})`);
}

// 3. Large grayscale photo (200×200mm @ 254 DPI ≈ 4MP, 2000×2000 px) →
//    pixelCount = 4_000_000 → exceeds WARN threshold (3M) → warning.
{
  const scene = createScene(400, 300, 'BigPhoto');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makeImageObject(layer.id, 2000, 2000)];
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  const blocker = out.find(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK);
  const warn = out.find(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_WARN);
  assert(warn != null && warn.severity === 'warning' && blocker == null,
    `4MP grayscale photo: WARN fires (got ${out.map(r => r.code).join(',')})`);
}

// 4. Full-bed 400×400mm at 254 DPI grayscale (≈ 4000×4000 = 16MP) →
//    16M lines > BLOCK threshold (10M) → error.
{
  const scene = createScene(400, 400, 'HugePhoto');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makeImageObject(layer.id, 4000, 4000)];
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  const blocker = out.find(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK);
  assert(blocker != null && blocker.severity === 'error',
    `16MP grayscale photo: BLOCK fires as error (got ${out.map(r => r.code).join(',')})`);
}

// 5. Memory threshold trips even when line count would be borderline.
//    A 250M-pixel image (theoretical) hits 800MB+ memory before the
//    line count would clear 10M. Verify the OR clause works.
{
  const scene = createScene(400, 300, 'HighMem');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  // Test the formula directly via estimateCompileComplexity rather than
  // building a giant scene.
  scene.objects = [makeImageObject(layer.id, 8000, 8000)]; // 64M pixels
  const e = estimateCompileComplexity(scene);
  // 64M pixels × 5 bytes + 64M lines × 80 bytes ≈ 320MB + 5120MB = 5.4 GB
  assert(e.estimatedMemoryMB > 800,
    `8000×8000 grayscale: memory estimate > 800MB (got ${e.estimatedMemoryMB.toFixed(0)}MB)`);
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  const blocker = out.find(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK);
  assert(blocker != null, 'large memory: BLOCK fires');
}

// 6. Mid-tier scene (1.5M lines) → INFO, not WARN
{
  const scene = createScene(400, 300, 'Mid');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  // 1300×1000 = 1.3M pixels → 1.3M lines (just over 1M info threshold).
  scene.objects = [makeImageObject(layer.id, 1300, 1000)];
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  const info = out.find(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_INFO);
  const warn = out.find(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_WARN);
  const block = out.find(r => r.code === PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK);
  assert(info != null && info.severity === 'info' && warn == null && block == null,
    `1.3M lines: INFO fires, no WARN/BLOCK (got ${out.map(r => r.code).join(',')})`);
}

// 7. Hidden layer's image is excluded from the estimate
{
  const scene = createScene(400, 300, 'HiddenLayer');
  const layer = createLayer(0, 'image', 'Raster');
  layer.visible = false;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makeImageObject(layer.id, 4000, 4000)];
  const e = estimateCompileComplexity(scene);
  assert(e.rasterPixels === 0, `hidden-layer image: not counted (got ${e.rasterPixels} px)`);
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  assert(out.length === 0, `hidden-layer image: no preflight result`);
}

// 8. Output:false layer's image is excluded
{
  const scene = createScene(400, 300, 'NoOutput');
  const layer = createLayer(0, 'image', 'Raster');
  layer.output = false;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makeImageObject(layer.id, 4000, 4000)];
  const e = estimateCompileComplexity(scene);
  assert(e.rasterPixels === 0, 'output:false layer image: not counted');
}

// 9. Hidden object is excluded
{
  const scene = createScene(400, 300, 'HiddenObj');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const obj = makeImageObject(layer.id, 4000, 4000);
  obj.visible = false;
  scene.objects = [obj];
  const e = estimateCompileComplexity(scene);
  assert(e.rasterPixels === 0, 'hidden object: not counted');
}

// 10. Estimator math sanity — empty scene returns zeros across the board
{
  const scene = createScene(400, 300, 'Empty');
  const e = estimateCompileComplexity(scene);
  assert(e.rasterPixels === 0 && e.vectorPathCount === 0 && e.vectorVertexCount === 0,
    'empty scene: estimator returns all zeros');
  assert(e.expectedGcodeLineCount === 0 && e.estimatedMemoryMB === 0,
    'empty scene: line count and memory both zero');
}

// 11. Mixed scene: vectors + small image → counted but no warning
{
  const scene = createScene(400, 300, 'Mixed');
  const cutLayer = createLayer(0, 'cut', 'Cut');
  const imgLayer = createLayer(1, 'image', 'Raster');
  scene.layers = [cutLayer, imgLayer];
  scene.activeLayerId = cutLayer.id;
  scene.objects = [
    makeRectObject(cutLayer.id, 100, 100),
    makeImageObject(imgLayer.id, 100, 100), // 10k pixels
  ];
  const e = estimateCompileComplexity(scene);
  assert(e.rasterPixels === 10_000, `mixed scene: rasterPixels = 10k (got ${e.rasterPixels})`);
  assert(e.vectorPathCount === 1, `mixed scene: 1 vector path (got ${e.vectorPathCount})`);
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(scene), out);
  assert(out.length === 0, `mixed-but-small scene: no warning`);
}

// 12. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const ruleSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/rules/CompileComplexityPreflight.ts'),
    'utf-8',
  );
  assert(/T1-45/.test(ruleSrc), 'T1-45 marker in CompileComplexityPreflight.ts');
  assert(/HARD_BLOCK_LINE_COUNT = 10_000_000/.test(ruleSrc),
    'BLOCK threshold = 10M lines');
  assert(/HARD_BLOCK_MEMORY_MB = 800/.test(ruleSrc),
    'BLOCK threshold = 800MB memory');
  assert(/WARN_LINE_COUNT_HIGH = 3_000_000/.test(ruleSrc),
    'WARN threshold = 3M lines');
  assert(/WARN_LINE_COUNT_INFO = 1_000_000/.test(ruleSrc),
    'INFO threshold = 1M lines');
  const preflightSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/Preflight.ts'),
    'utf-8',
  );
  assert(/runCompileComplexityChecks/.test(preflightSrc),
    'runPreflight invokes runCompileComplexityChecks');
  assert(/COMPILE_COMPLEXITY_BLOCK/.test(preflightSrc),
    'PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK declared');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
