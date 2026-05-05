/**
 * T1-17 Pass 4c: PropertiesPanel.commitImageSettings calls
 * `warmProcessedImageCache` after `onSceneCommit` to populate
 * `geom.processedData` + `geom.processedSettings`. JobCompiler (Pass 4b)
 * picks up the cache and skips the legacy ImageProcessing pipeline.
 *
 * This test pins the helper's contract end-to-end, including the
 * fingerprint-recheck guard that protects against stale writes when
 * the user commits faster than the worker resolves.
 *
 * Run: npx tsx tests/warm-processed-image-cache-pass4c.test.ts
 */
import { warmProcessedImageCache } from '../src/ui/hooks/useImageCacheWarmer';
import { processImageMainThread } from '../src/workers/imagePrepClient';
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

const W = 4, H = 4;

function makeSceneWithImage(grayscale: Uint8Array, geomOverrides?: Partial<ImageGeometry>) {
  const scene = createScene(400, 300, 'Pass4c');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const geom: ImageGeometry = {
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
    ...geomOverrides,
  };
  const obj: SceneObject = {
    id: 'img-1',
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

function getImageGeom(scene: ReturnType<typeof createScene>): ImageGeometry | null {
  const o = scene.objects.find(x => x.id === 'img-1');
  if (!o || o.geometry.type !== 'image') return null;
  return o.geometry as ImageGeometry;
}

console.log('\n=== T1-17 Pass 4c — warmProcessedImageCache ===\n');

void (async () => {

// 1. Successful warm: settings still match → applyScene called with
//    processedData + processedSettings populated; the data byte-matches
//    what processImageMainThread (the worker fallback) produces.
{
  const grayscale = new Uint8Array(W * H);
  for (let i = 0; i < grayscale.length; i++) grayscale[i] = (i * 11 + 50) & 0xff;
  let scene = makeSceneWithImage(grayscale, { brightness: 25, contrast: 0, gamma: 1, invert: false });
  let applyCount = 0;
  await warmProcessedImageCache(
    'img-1',
    { brightness: 25, contrast: 0, gamma: 1, invert: false },
    () => scene,
    (s) => { scene = s; applyCount++; },
  );
  assert(applyCount === 1, `successful warm: applyScene called once (got ${applyCount})`);
  const g = getImageGeom(scene);
  assert(g?.processedData != null, 'successful warm: processedData populated');
  assert(g?.processedSettings != null, 'successful warm: processedSettings populated');
  assert(g?.processedSettings?.brightness === 25, 'fingerprint brightness=25');
  // Verify byte-for-byte match with the synchronous fallback math.
  const expected = processImageMainThread(grayscale, W, H, {
    brightness: 25, contrast: 0, gamma: 1, invert: false, threshold: null,
  });
  let same = true;
  if (g?.processedData) for (let i = 0; i < expected.length; i++) {
    if (g.processedData[i] !== expected[i]) { same = false; break; }
  }
  assert(same, 'successful warm: cached data === processImageMainThread output');
}

// 2. Stale fingerprint: settings change between commit and worker
//    completion → applyScene NOT called.
{
  const grayscale = new Uint8Array(W * H).fill(127);
  let scene = makeSceneWithImage(grayscale, { brightness: 25, contrast: 0, gamma: 1, invert: false });
  let applyCount = 0;
  // Simulate user dragging again before the worker resolves: between
  // the read of `before` and the write of `after`, mutate the scene to
  // a different brightness. We do this via overriding getScene to
  // return a different snapshot the second time it's called.
  let calls = 0;
  const getScene = () => {
    calls++;
    if (calls === 1) return scene; // initial snapshot
    // Second call (after worker await) returns the "user dragged again" state
    return makeSceneWithImage(grayscale, { brightness: 50, contrast: 0, gamma: 1, invert: false });
  };
  await warmProcessedImageCache(
    'img-1',
    { brightness: 25, contrast: 0, gamma: 1, invert: false },
    getScene,
    () => { applyCount++; },
  );
  assert(applyCount === 0, `stale fingerprint: applyScene NOT called (got ${applyCount})`);
}

// 3. Object deleted between commit and worker completion → no apply
{
  const grayscale = new Uint8Array(W * H).fill(127);
  let scene = makeSceneWithImage(grayscale);
  let applyCount = 0;
  let calls = 0;
  const getScene = () => {
    calls++;
    if (calls === 1) return scene;
    // Second snapshot: object is gone
    const empty = createScene(400, 300, 'Empty');
    return empty;
  };
  await warmProcessedImageCache(
    'img-1',
    { brightness: 25, contrast: 0, gamma: 1, invert: false },
    getScene,
    () => { applyCount++; },
  );
  assert(applyCount === 0, 'object deleted: applyScene NOT called');
}

// 4. Object's geometry type changed (image → path) between commit and
//    completion → no apply (defensive)
{
  const grayscale = new Uint8Array(W * H).fill(127);
  let scene = makeSceneWithImage(grayscale);
  let applyCount = 0;
  let calls = 0;
  const getScene = () => {
    calls++;
    if (calls === 1) return scene;
    // Second snapshot: object exists but geometry type flipped
    const after = makeSceneWithImage(grayscale);
    after.objects = after.objects.map(o => o.id === 'img-1' ? {
      ...o,
      geometry: { type: 'path' as const, subPaths: [] },
    } : o);
    return after;
  };
  await warmProcessedImageCache(
    'img-1',
    { brightness: 25, contrast: 0, gamma: 1, invert: false },
    getScene,
    () => { applyCount++; },
  );
  assert(applyCount === 0, 'geometry type changed: applyScene NOT called');
}

// 5. Missing grayscaleData → no worker call, no apply (early return)
{
  const scene = makeSceneWithImage(new Uint8Array(0), { grayscaleData: undefined });
  let applyCount = 0;
  await warmProcessedImageCache(
    'img-1',
    { brightness: 0, contrast: 0, gamma: 1, invert: false },
    () => scene,
    () => { applyCount++; },
  );
  assert(applyCount === 0, 'missing grayscaleData: applyScene NOT called (early return)');
}

// 6. Object id not found → no worker call, no apply
{
  const grayscale = new Uint8Array(W * H).fill(127);
  const scene = makeSceneWithImage(grayscale);
  let applyCount = 0;
  await warmProcessedImageCache(
    'nonexistent-id',
    { brightness: 0, contrast: 0, gamma: 1, invert: false },
    () => scene,
    () => { applyCount++; },
  );
  assert(applyCount === 0, 'unknown object id: applyScene NOT called');
}

// 7. Default-valued settings on geom (no brightness key set) treated as
//    0/0/1/false fingerprint — successful warm at all-defaults
{
  const grayscale = new Uint8Array(W * H).fill(127);
  let scene = makeSceneWithImage(grayscale); // no brightness/contrast/gamma/invert keys
  let applyCount = 0;
  await warmProcessedImageCache(
    'img-1',
    { brightness: 0, contrast: 0, gamma: 1, invert: false },
    () => scene,
    (s) => { scene = s; applyCount++; },
  );
  assert(applyCount === 1, 'default-valued geom: applyScene called once at all-defaults match');
  const g = getImageGeom(scene);
  assert(g?.processedSettings?.brightness === 0,
    `default-valued geom: processedSettings.brightness = 0 (got ${g?.processedSettings?.brightness})`);
}

// 8. Invert mismatch alone is caught (covers each fingerprint field)
{
  const grayscale = new Uint8Array(W * H).fill(127);
  let scene = makeSceneWithImage(grayscale, { invert: false });
  let applyCount = 0;
  let calls = 0;
  const getScene = () => {
    calls++;
    if (calls === 1) return scene;
    return makeSceneWithImage(grayscale, { invert: true });
  };
  await warmProcessedImageCache(
    'img-1',
    { brightness: 0, contrast: 0, gamma: 1, invert: false },
    getScene,
    () => { applyCount++; },
  );
  assert(applyCount === 0, 'invert mismatch alone discards stale write');
}

// 9. Source-level pin: PropertiesPanel calls warmProcessedImageCache
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const panelSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/PropertiesPanel.tsx'),
    'utf-8',
  );
  assert(/T1-17 Pass 4c/.test(panelSrc), 'T1-17 Pass 4c marker in PropertiesPanel.tsx');
  assert(/warmProcessedImageCache\(/.test(panelSrc),
    'PropertiesPanel.commitImageSettings invokes warmProcessedImageCache');
  assert(/from '\.\.\/hooks\/useImageCacheWarmer'/.test(panelSrc),
    'PropertiesPanel imports warmProcessedImageCache from the hooks module');

  const helperSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/hooks/useImageCacheWarmer.ts'),
    'utf-8',
  );
  assert(/T1-17 Pass 4c/.test(helperSrc), 'T1-17 Pass 4c marker in helper source');
  assert(/processImage\(/.test(helperSrc), 'helper calls processImage');
  assert(/processedData/.test(helperSrc) && /processedSettings/.test(helperSrc),
    'helper writes both processedData and processedSettings');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
