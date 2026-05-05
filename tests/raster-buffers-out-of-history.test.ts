/**
 * T2-81: history snapshots must NOT carry the regenerable
 * `processedData` cache that Pass 4c writes on slider commit. Pre-T2-81
 * an image-heavy slider workflow with 100 commits could balloon
 * history memory by 100× the image size — for a 4MP image, ~400MB.
 * `processedData` is a JobCompiler-side cache that re-derives from
 * `grayscaleData + processedSettings.{brightness,contrast,gamma,
 * invert}` deterministically; stripping it from snapshots is safe.
 *
 * The MVP shipped here removes `processedData` + `processedSettings`
 * only; `grayscaleData` (source-of-truth raster) and `adjustedData`
 * (read by SceneRenderer for dither preview) stay. The audit's full
 * proposal — moving both buffers to a keyed cache outside history —
 * is filed as T2-81-followup.
 *
 * Run: npx tsx tests/raster-buffers-out-of-history.test.ts
 */
import { HistoryManager } from '../src/ui/history/HistoryManager';
import { stripRegenerableImageCaches } from '../src/ui/history/stripRegenerableCaches';
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

function makeImageScene(opts: {
  withProcessed?: boolean;
  withAdjusted?: boolean;
  imageBytes?: number;
}): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'T2-81');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;

  const W = 64, H = 64; // 4096 grayscale bytes; 4096 processed bytes
  const grayscale = new Uint8Array(W * H);
  for (let i = 0; i < grayscale.length; i++) grayscale[i] = i & 0xff;

  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: W,
    originalHeight: H,
    cropX: 0, cropY: 0, cropWidth: W, cropHeight: H,
    grayscaleData: grayscale,
    grayscaleWidth: W,
    grayscaleHeight: H,
    brightness: 25,
    contrast: 0,
    gamma: 1,
    invert: false,
  };
  if (opts.withProcessed) {
    const processed = new Uint8Array(opts.imageBytes ?? W * H);
    for (let i = 0; i < processed.length; i++) processed[i] = (i * 13) & 0xff;
    geom.processedData = processed;
    geom.processedSettings = { brightness: 25, contrast: 0, gamma: 1, invert: false };
  }
  if (opts.withAdjusted) {
    const adjusted = new Uint8Array(opts.imageBytes ?? W * H);
    geom.adjustedData = adjusted;
    geom.ditherMode = 'floyd-steinberg';
  }
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

function imageGeomOf(scene: ReturnType<typeof createScene>): ImageGeometry | null {
  const o = scene.objects.find(x => x.geometry.type === 'image');
  return o ? o.geometry as ImageGeometry : null;
}

console.log('\n=== T2-81 raster buffers out of history ===\n');

void (async () => {

// 1. stripRegenerableImageCaches removes processedData + processedSettings
{
  const scene = makeImageScene({ withProcessed: true });
  const stripped = stripRegenerableImageCaches(scene);
  const g = imageGeomOf(stripped);
  assert(g != null && g.processedData == null,
    'strip: processedData removed');
  assert(g != null && g.processedSettings == null,
    'strip: processedSettings removed');
}

// 2. strip preserves grayscaleData (source-of-truth, NOT a cache)
{
  const scene = makeImageScene({ withProcessed: true });
  const original = imageGeomOf(scene);
  const stripped = stripRegenerableImageCaches(scene);
  const g = imageGeomOf(stripped);
  assert(g != null && g.grayscaleData === original?.grayscaleData,
    'strip: grayscaleData reference preserved (no copy)');
}

// 3. strip preserves adjustedData (used by SceneRenderer for dither preview)
{
  const scene = makeImageScene({ withProcessed: true, withAdjusted: true });
  const original = imageGeomOf(scene);
  const stripped = stripRegenerableImageCaches(scene);
  const g = imageGeomOf(stripped);
  assert(g != null && g.adjustedData === original?.adjustedData,
    'strip: adjustedData preserved (SceneRenderer dither preview path unaffected)');
  assert(g != null && g.ditherMode === 'floyd-steinberg',
    'strip: ditherMode preserved');
}

// 4. No-op when no image carries a regenerable cache → returns input
//    reference unchanged (allocation-free)
{
  const scene = makeImageScene({ withProcessed: false });
  const stripped = stripRegenerableImageCaches(scene);
  assert(stripped === scene,
    'no-op: identity preserved when nothing to strip');
}

// 5. HistoryManager.push stores the stripped scene
{
  const hm = new HistoryManager();
  const scene = makeImageScene({ withProcessed: true });
  hm.push(scene, { action: 'edit' });
  const stored = hm.undoEntry();
  // undoEntry moves cursor back; push at cursor 0 means undoEntry returns null
  // (no prior entry to undo to). Use direct stack inspection instead.
  void stored;
  // We test the stored shape via the redo path or by re-reading.
  // Simpler: push twice, then peek at the first entry.
  const hm2 = new HistoryManager();
  hm2.push(scene, { action: 'edit' });
  const sceneB = makeImageScene({ withProcessed: true });
  hm2.push(sceneB, { action: 'edit' });
  // Now undo to first entry
  const back = hm2.undoEntry();
  assert(back != null, 'undo returns previous entry');
  if (back) {
    const g = imageGeomOf(back.scene);
    assert(g != null && g.processedData == null,
      'history.push: stored entry has processedData stripped');
    assert(g != null && g.grayscaleData != null,
      'history.push: stored entry retains grayscaleData');
  }
}

// 6. No-op-commit guard still works after T2-81. The PRE-strip
//    reference is tracked separately so push(sameScene) returns
//    early even when stripping produces a different stored object.
{
  const hm = new HistoryManager();
  const scene = makeImageScene({ withProcessed: true });
  hm.push(scene, { action: 'edit' });
  const beforeCount = hm.getState().totalSnapshots;
  hm.push(scene, { action: 'edit' }); // same reference
  const afterCount = hm.getState().totalSnapshots;
  assert(beforeCount === afterCount,
    `no-op guard: pushing same scene ref doesn't add an entry (got ${beforeCount} → ${afterCount})`);
}

// 7. Different scene refs DO get pushed (no false-negative on guard)
{
  const hm = new HistoryManager();
  hm.push(makeImageScene({ withProcessed: true }), { action: 'edit' });
  hm.push(makeImageScene({ withProcessed: true }), { action: 'edit' });
  hm.push(makeImageScene({ withProcessed: true }), { action: 'edit' });
  const s = hm.getState();
  assert(s.totalSnapshots === 3,
    `distinct scenes: 3 entries (got ${s.totalSnapshots})`);
}

// 8. Memory-shape sanity: pushing 50 image scenes with processedData,
//    each carrying 4096 bytes of cache. Verify the stored entries do
//    NOT carry the cache.
{
  const hm = new HistoryManager();
  for (let i = 0; i < 50; i++) {
    hm.push(makeImageScene({ withProcessed: true, imageBytes: 4096 }), { action: 'edit' });
  }
  // Walk the stack via undoEntry to inspect each
  let strippedCount = 0;
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const e = hm.undoEntry();
    if (e == null) break;
    total++;
    const g = imageGeomOf(e.scene);
    if (g && g.processedData == null) strippedCount++;
  }
  assert(strippedCount === total && total >= 49,
    `50 image-cache pushes: every reachable history entry has processedData stripped (got ${strippedCount}/${total})`);
}

// 9. Reset path also strips
{
  const hm = new HistoryManager();
  const scene = makeImageScene({ withProcessed: true });
  hm.reset(scene, { action: 'init' });
  // After reset, the only entry is at cursor 0; it has no prior to
  // undo to. Inspect by pushing one more, then undoing back.
  hm.push(makeImageScene({ withProcessed: false }), { action: 'edit' });
  const back = hm.undoEntry();
  if (back) {
    const g = imageGeomOf(back.scene);
    assert(g != null && g.processedData == null,
      'reset: initial scene also has processedData stripped');
  }
}

// 10. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const stripSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/history/stripRegenerableCaches.ts'),
    'utf-8',
  );
  assert(/T2-81/.test(stripSrc), 'T2-81 marker in stripRegenerableCaches.ts');
  assert(/processedData/.test(stripSrc) && /processedSettings/.test(stripSrc),
    'strip helper names both fields it removes');

  const hmSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/history/HistoryManager.ts'),
    'utf-8',
  );
  assert(/T2-81/.test(hmSrc), 'T2-81 marker in HistoryManager.ts');
  assert(/stripRegenerableImageCaches/.test(hmSrc),
    'HistoryManager imports + uses stripRegenerableImageCaches');
  assert(/_lastPushedScene/.test(hmSrc),
    'HistoryManager tracks _lastPushedScene for the no-op guard');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
