/**
 * T1-17 Pass 4b: JobCompiler consumes pre-computed `processedData` when
 * the cached `processedSettings` fingerprint matches the layer's current
 * brightness/contrast/gamma/invert. This test pins the consumer side.
 * Pass 4c (UI calls processImage worker on slider drag) populates the
 * cache; this ticket only adds the JobCompiler fast path.
 *
 * Run: npx tsx tests/jobcompiler-uses-processed-data-pass4b.test.ts
 */
import { compileJob } from '../src/core/job/JobCompiler';
import { createBlankProfile, saveDeviceProfile, setActiveProfileId } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type ImageGeometry, type SceneObject } from '../src/core/scene/SceneObject';
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

const memoryStore: Record<string, string> = {};
function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return Object.keys(memoryStore).length; },
    clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
    getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
    key: (i: number) => Object.keys(memoryStore)[i] ?? null,
    removeItem: (k: string) => { delete memoryStore[k]; },
    setItem: (k: string, v: string) => { memoryStore[k] = v; },
  } as Storage;
}

const W = 4, H = 4;

function makeImageGeom(grayscale: Uint8Array, opts?: {
  processedData?: Uint8Array;
  processedSettings?: { brightness: number; contrast: number; gamma: number; invert: boolean };
}): ImageGeometry {
  return {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: W,
    originalHeight: H,
    cropX: 0,
    cropY: 0,
    cropWidth: W,
    cropHeight: H,
    grayscaleData: grayscale,
    grayscaleWidth: W,
    grayscaleHeight: H,
    processedData: opts?.processedData,
    processedSettings: opts?.processedSettings,
  };
}

function makeRasterScene(geom: ImageGeometry, layerSettings: {
  brightness?: number; contrast?: number; gamma?: number; invert?: boolean;
  imageMode?: 'grayscale' | 'threshold' | 'dither';
  imageThreshold?: number;
}): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'Pass4b');
  const layer = createLayer(0, 'image', 'Raster');
  layer.settings.speed = 6000;
  layer.settings.power = { min: 20, max: 80 };
  layer.settings.image.brightness = layerSettings.brightness ?? 0;
  layer.settings.image.contrast = layerSettings.contrast ?? 0;
  layer.settings.image.gamma = layerSettings.gamma ?? 1;
  layer.settings.image.invert = layerSettings.invert ?? false;
  layer.settings.image.imageMode = layerSettings.imageMode ?? 'grayscale';
  layer.settings.image.imageThreshold = layerSettings.imageThreshold ?? 128;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const obj: SceneObject = {
    id: generateId(),
    type: 'image',
    name: 'img',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 10, ty: 10 },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [obj];
  return scene;
}

function getRasterBitmapData(job: ReturnType<typeof compileJob>): Uint8Array | undefined {
  const raster = job.operations.find(op => op.type === 'raster');
  if (!raster || raster.geometry.type !== 'raster') return undefined;
  return raster.geometry.bitmap.data;
}

console.log('\n=== T1-17 Pass 4b — JobCompiler uses processedData ===\n');

void (async () => {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('T1-17-pass4b');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  // 1. Cache hit: processedData + matching fingerprint → JobCompiler uses
  //    the cached buffer verbatim, skipping the legacy ImageProcessing
  //    pipeline. Distinctive sentinel pattern in processedData proves
  //    the fast path fired.
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const sentinel = new Uint8Array(W * H);
    for (let i = 0; i < sentinel.length; i++) sentinel[i] = (i * 17 + 5) & 0xff;
    const geom = makeImageGeom(grayscale, {
      processedData: sentinel,
      processedSettings: { brightness: 25, contrast: 0, gamma: 1, invert: false },
    });
    const scene = makeRasterScene(geom, { brightness: 25, imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    assert(out != null && out.length === sentinel.length,
      `cache hit: bitmap data has expected length (got ${out?.length ?? 'undefined'})`);
    let same = true;
    if (out) for (let i = 0; i < sentinel.length; i++) if (out[i] !== sentinel[i]) { same = false; break; }
    assert(same, 'cache hit: bitmap.data === processedData byte-for-byte (legacy pipeline NOT applied)');
  }

  // 2. Mismatched brightness fingerprint → fall back to legacy pipeline.
  //    The cached sentinel is NOT used; JobCompiler runs adjustBrightness
  //    on grayscaleData which produces a different result.
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const sentinel = new Uint8Array(W * H).fill(99);
    const geom = makeImageGeom(grayscale, {
      processedData: sentinel,
      processedSettings: { brightness: 25, contrast: 0, gamma: 1, invert: false },
    });
    // Layer asks for brightness=50 but cache says =25 → mismatch → fallback.
    const scene = makeRasterScene(geom, { brightness: 50, imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    assert(out != null, 'fingerprint mismatch: bitmap data still produced (fallback path)');
    assert(out !== sentinel && (out?.[0] ?? -1) !== 99,
      `fingerprint mismatch: bitmap.data is NOT the cached sentinel (got [0]=${out?.[0]})`);
    // brightness=50 → delta = 50*2.55 = 127.5 → 127+127.5 = 254.5 → round = 255.
    assert(out?.[0] === 255,
      `fingerprint mismatch: legacy adjustBrightness ran (got [0]=${out?.[0]}, expected 255)`);
  }

  // 3. Mismatched contrast fingerprint → fallback
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const sentinel = new Uint8Array(W * H).fill(0);
    const geom = makeImageGeom(grayscale, {
      processedData: sentinel,
      processedSettings: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    });
    const scene = makeRasterScene(geom, { contrast: 50, imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    assert(out != null && out[0] !== 0,
      `contrast mismatch: legacy contrast pipeline ran (got [0]=${out?.[0]}, sentinel was 0)`);
  }

  // 4. Mismatched gamma fingerprint → fallback
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const sentinel = new Uint8Array(W * H).fill(7);
    const geom = makeImageGeom(grayscale, {
      processedData: sentinel,
      processedSettings: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    });
    const scene = makeRasterScene(geom, { gamma: 2.2, imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    assert(out != null && out[0] !== 7,
      `gamma mismatch: legacy gamma pipeline ran (got [0]=${out?.[0]}, sentinel was 7)`);
  }

  // 5. Mismatched invert fingerprint → fallback
  {
    const grayscale = new Uint8Array(W * H).fill(50);
    const sentinel = new Uint8Array(W * H).fill(50);
    const geom = makeImageGeom(grayscale, {
      processedData: sentinel,
      processedSettings: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    });
    const scene = makeRasterScene(geom, { invert: true, imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    // invert(50) = 205. Sentinel is 50 (unchanged from input). Fallback runs invert → 205.
    assert(out?.[0] === 205,
      `invert mismatch: legacy invert pipeline ran (got [0]=${out?.[0]}, expected 205)`);
  }

  // 6. processedData absent → fallback (existing path unchanged)
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const geom = makeImageGeom(grayscale); // no processedData/processedSettings
    const scene = makeRasterScene(geom, { brightness: 0, imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    assert(out?.[0] === 127,
      `no cache: legacy path returns grayscale unchanged at brightness=0 (got [0]=${out?.[0]})`);
  }

  // 7. processedSettings absent (only processedData set) → fallback
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const sentinel = new Uint8Array(W * H).fill(99);
    const geom = makeImageGeom(grayscale, { processedData: sentinel });
    const scene = makeRasterScene(geom, { brightness: 25, imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    assert(out?.[0] !== 99,
      `processedSettings absent: cache NOT used (sentinel would be 99, got [0]=${out?.[0]})`);
  }

  // 8. processedData length mismatch → fallback (defensive)
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const sentinelWrongLen = new Uint8Array(W * H + 4).fill(42);
    const geom = makeImageGeom(grayscale, {
      processedData: sentinelWrongLen,
      processedSettings: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    });
    const scene = makeRasterScene(geom, { imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    assert(out?.length === W * H,
      `length mismatch: bitmap output uses grayscale dims, not cache length (got len=${out?.length})`);
    assert(out?.[0] === 127,
      `length mismatch: cache rejected, fallback ran (got [0]=${out?.[0]})`);
  }

  // 9. Cache hit at zero-brightness no-op: even with brightness=0 etc, the
  //    fast path still fires when the fingerprint matches. Proves the
  //    check isn't gated on "any setting non-default".
  {
    const grayscale = new Uint8Array(W * H).fill(127);
    const sentinel = new Uint8Array(W * H);
    for (let i = 0; i < sentinel.length; i++) sentinel[i] = (200 + i) & 0xff;
    const geom = makeImageGeom(grayscale, {
      processedData: sentinel,
      processedSettings: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    });
    const scene = makeRasterScene(geom, { imageMode: 'grayscale' });
    const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    const out = getRasterBitmapData(job);
    let same = true;
    if (out) for (let i = 0; i < sentinel.length; i++) if (out[i] !== sentinel[i]) { same = false; break; }
    assert(same,
      'cache hit at all-default settings: fast path still fires (fingerprint match drives it, not change-from-default)');
  }

  // 10. Source-level pin
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const compilerSrc = fs.readFileSync(path.resolve(here, '../src/core/job/JobCompiler.ts'), 'utf-8');
    assert(/T1-17 Pass 4b/.test(compilerSrc), 'T1-17 Pass 4b marker in JobCompiler.ts');
    assert(/canReuseProcessed/.test(compilerSrc), 'canReuseProcessed local declared');
    assert(/processedSettings/.test(compilerSrc), 'JobCompiler reads processedSettings');

    const sceneSrc = fs.readFileSync(path.resolve(here, '../src/core/scene/SceneObject.ts'), 'utf-8');
    assert(/processedData\?: Uint8Array/.test(sceneSrc),
      'ImageGeometry declares processedData');
    assert(/processedSettings\?: ProcessedImageSettings/.test(sceneSrc),
      'ImageGeometry declares processedSettings');
    assert(/T1-17 Pass 4b/.test(sceneSrc), 'T1-17 Pass 4b marker in SceneObject.ts');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => { console.error(e); process.exit(1); });
