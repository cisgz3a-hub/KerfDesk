/**
 * T2-82: HistoryManager evicts on EITHER count OR approximate-bytes
 * budget, with at-least-one-entry retained. Pre-T2-82 only the count
 * limit existed (`maxSize=100`); 50 entries with 5MB images = 250MB,
 * well over what most browsers tolerate. T2-81 reduced per-entry size;
 * T2-82 adds the actual budget enforcement.
 *
 * Run: npx tsx tests/history-memory-budget.test.ts
 */
import { HistoryManager } from '../src/ui/history/HistoryManager';
import { estimateSceneBytes } from '../src/ui/history/estimateSceneBytes';
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

function makeSmallScene(label: string): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, label);
  const layer = createLayer(0, 'cut', 'Cut');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  return scene;
}

function makeImageScene(grayscaleBytes: number): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'img');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: 100, originalHeight: 100,
    cropX: 0, cropY: 0, cropWidth: 100, cropHeight: 100,
    grayscaleData: new Uint8Array(grayscaleBytes),
    grayscaleWidth: 100, grayscaleHeight: 100,
  };
  const obj: SceneObject = {
    id: generateId(),
    type: 'image',
    name: 'img',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
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

console.log('\n=== T2-82 history memory budget ===\n');

void (async () => {

// 1. estimateSceneBytes: empty scene returns positive (overhead)
{
  const scene = makeSmallScene('empty');
  const bytes = estimateSceneBytes(scene);
  assert(bytes > 0 && bytes < 10_000,
    `empty scene: estimate is small but non-zero (got ${bytes})`);
}

// 2. estimateSceneBytes: image with 5MB grayscale ≈ 5MB+
{
  const scene = makeImageScene(5 * 1024 * 1024);
  const bytes = estimateSceneBytes(scene);
  assert(bytes >= 5 * 1024 * 1024 && bytes < 6 * 1024 * 1024,
    `5MB image scene: estimate ≈ 5MB (got ${(bytes / 1024 / 1024).toFixed(1)}MB)`);
}

// 3. Count limit: push 200 small scenes, only `maxSize` retained
{
  const hm = new HistoryManager(50);
  for (let i = 0; i < 200; i++) hm.push(makeSmallScene(`s${i}`));
  const s = hm.getState();
  assert(s.totalSnapshots === 50,
    `count-limit: 200 pushes → 50 entries (got ${s.totalSnapshots})`);
}

// 4. Byte limit: push 50 image scenes (each ~5MB) with maxBytes=20MB →
//    eviction triggers when total bytes > 20MB
{
  const hm = new HistoryManager(100, 20 * 1024 * 1024);
  // Suppress the eviction console.warn for this test (expected)
  const origWarn = console.warn;
  console.warn = () => { /* swallow */ };
  try {
    for (let i = 0; i < 50; i++) hm.push(makeImageScene(5 * 1024 * 1024));
  } finally {
    console.warn = origWarn;
  }
  const s = hm.getState();
  // 5MB scenes × 4 = 20MB; budget is 20MB so we can hold 4 entries
  // (5th evicts). Allow ±1 entry for estimator overhead.
  assert(s.totalSnapshots >= 3 && s.totalSnapshots <= 5,
    `byte-limit: 50 × 5MB pushes with 20MB budget → 3-5 entries retained (got ${s.totalSnapshots})`);
  const total = hm.totalBytes();
  assert(total <= 20 * 1024 * 1024 + 5 * 1024 * 1024,
    `byte-limit: total bytes within budget + 1 entry margin (got ${(total / 1024 / 1024).toFixed(1)}MB)`);
}

// 5. At-least-one-entry: even when a single scene exceeds the byte
//    budget, the stack retains it
{
  const hm = new HistoryManager(100, 1 * 1024 * 1024); // 1MB budget
  const origWarn = console.warn;
  console.warn = () => { /* swallow */ };
  try {
    hm.push(makeImageScene(10 * 1024 * 1024)); // 10MB scene
  } finally {
    console.warn = origWarn;
  }
  const s = hm.getState();
  assert(s.totalSnapshots === 1,
    `over-budget single push: 1 entry retained (got ${s.totalSnapshots})`);
}

// 6. Eviction warns (one warn per push that evicted)
{
  const hm = new HistoryManager(2, 100 * 1024 * 1024);
  let warnCount = 0;
  const origWarn = console.warn;
  console.warn = (msg: unknown) => {
    if (typeof msg === 'string' && /T2-82/.test(msg)) warnCount++;
  };
  try {
    hm.push(makeSmallScene('a'));
    hm.push(makeSmallScene('b'));
    hm.push(makeSmallScene('c')); // evicts 'a' (count > 2)
    hm.push(makeSmallScene('d')); // evicts 'b'
  } finally {
    console.warn = origWarn;
  }
  assert(warnCount === 2,
    `eviction warning: ~once per push that evicts (got ${warnCount} warns from 2 evicting pushes)`);
}

// 7. totalBytes() reflects current stack
{
  const hm = new HistoryManager();
  const before = hm.totalBytes();
  assert(before === 0, `empty history: totalBytes=0 (got ${before})`);
  hm.push(makeImageScene(2 * 1024 * 1024));
  const after = hm.totalBytes();
  assert(after >= 2 * 1024 * 1024 && after < 3 * 1024 * 1024,
    `after 2MB image: totalBytes ≈ 2MB (got ${(after / 1024 / 1024).toFixed(1)}MB)`);
}

// 8. reset() resets the byte tracker too
{
  const hm = new HistoryManager();
  hm.push(makeImageScene(5 * 1024 * 1024));
  const big = hm.totalBytes();
  hm.reset(makeSmallScene('reset'));
  const small = hm.totalBytes();
  assert(small < big,
    `reset: totalBytes drops (got ${(big / 1024 / 1024).toFixed(1)}MB → ${(small / 1024 / 1024).toFixed(2)}MB)`);
  assert(small > 0 && small < 10_000,
    `reset: totalBytes ≈ small-scene overhead (got ${small})`);
}

// 9. clear() zeroes the byte tracker
{
  const hm = new HistoryManager();
  hm.push(makeImageScene(2 * 1024 * 1024));
  hm.clear();
  assert(hm.totalBytes() === 0, 'clear: totalBytes=0');
}

// 10. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const hmSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/history/HistoryManager.ts'),
    'utf-8',
  );
  assert(/T2-82/.test(hmSrc), 'T2-82 marker in HistoryManager.ts');
  assert(/_maxBytes/.test(hmSrc), '_maxBytes private field declared');
  assert(/_entryBytes: number\[\]/.test(hmSrc),
    '_entryBytes parallel array declared');
  assert(/totalBytes\(\): number/.test(hmSrc),
    'totalBytes() public method declared');
  assert(/this\._stack\.length > 1/.test(hmSrc),
    'eviction loop retains at least one entry');
  const estSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/history/estimateSceneBytes.ts'),
    'utf-8',
  );
  assert(/T2-82/.test(estSrc), 'T2-82 marker in estimateSceneBytes.ts');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
