/**
 * T1-31: raster operation emits ONE M4 (laserOn) at the start of the
 * operation and ONE M5 (laserOff) at the end at the plan layer. Burn
 * segments within a scanline are stitched together with power=0 linear
 * moves bridging the gaps; the output encoder owns the final hard-off
 * bracketing around emitted G0 travel.
 *
 * Run: npx tsx tests/raster-output-uses-modal-m4.test.ts
 */
import { compileJob } from '../src/core/job/JobCompiler';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
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

/**
 * Build a 4-row × 16-col bitmap with several segments per row to
 * exercise both per-scanline gap bridging and inter-scanline rapids.
 *
 * Pattern (X = burn, . = blank):
 *   row 0: XXXX....XXXX....    (2 segments)
 *   row 1: ...XX...XX....XX    (3 segments)
 *   row 2: XXXXXXXXXXXXXXXX    (1 segment, full row)
 *   row 3: ...........XXXXX    (1 segment)
 *
 * 1-bit mode for deterministic segment power.
 */
function makeSceneWithMultiSegmentBitmap() {
  const scene = createScene(400, 300, 'T1-31');
  const layer = createLayer(0, 'image', 'Raster');
  layer.settings.speed = 6000;
  layer.settings.power = { min: 20, max: 80 };
  layer.settings.image.imageMode = 'threshold';
  layer.settings.image.imageThreshold = 128;
  layer.settings.image.dithering = 'none';
  layer.settings.image.passThrough = false;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;

  const W = 16, H = 4;
  // 'threshold' imageMode runs `thresholdToOneBit` (pixel < threshold → 255 burn,
  // else 0). Fill default 255 (above threshold = blank), then overwrite the
  // burn cells with 0 so they fall below threshold.
  const data = new Uint8Array(W * H).fill(255);
  function setBurn(r: number, c: number) { data[r * W + c] = 0; }
  // Row 0: cols 0-3 burn, 4-7 blank, 8-11 burn, 12-15 blank
  for (let c = 0; c < 4; c++) setBurn(0, c);
  for (let c = 8; c < 12; c++) setBurn(0, c);
  // Row 1: cols 3-4 burn, 8-9 burn, 14-15 burn
  setBurn(1, 3); setBurn(1, 4);
  setBurn(1, 8); setBurn(1, 9);
  setBurn(1, 14); setBurn(1, 15);
  // Row 2: all burn
  for (let c = 0; c < W; c++) setBurn(2, c);
  // Row 3: cols 11-15 burn
  for (let c = 11; c < 16; c++) setBurn(3, c);

  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: W,
    originalHeight: H,
    cropX: 0,
    cropY: 0,
    cropWidth: W,
    cropHeight: H,
    grayscaleData: data,
    grayscaleWidth: W,
    grayscaleHeight: H,
  };
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

console.log('\n=== T1-31 raster output uses modal M4 ===\n');

void (async () => {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('T1-31-test');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  const scene = makeSceneWithMultiSegmentBitmap();
  const job = compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: true });
  const plan = optimizePlan(job);

  // PlannedOperation has no `.type`; look up the matching Job.Operation
  // by operationId. The test scene has only one raster op.
  const rasterJobOp = job.operations.find(o => o.type === 'raster');
  if (!rasterJobOp) {
    console.error('no raster operation in compiled job');
    process.exit(1);
  }
  const rasterPlanOps = plan.operations.filter(p => p.operationId === rasterJobOp.id);
  if (rasterPlanOps.length !== 1) {
    console.error(`expected 1 raster planned operation; got ${rasterPlanOps.length}`);
    process.exit(1);
  }
  const moves = rasterPlanOps[0].moves;

  const laserOnCount = moves.filter(m => m.type === 'laserOn').length;
  const laserOffCount = moves.filter(m => m.type === 'laserOff').length;
  const rapidCount = moves.filter(m => m.type === 'rapid').length;
  const linearCount = moves.filter(m => m.type === 'linear').length;
  const linearZeroPowerCount = moves.filter(m => m.type === 'linear' && m.power === 0).length;

  // 1. Exactly ONE laserOn for the whole raster pass.
  assert(laserOnCount === 1,
    `exactly ONE laserOn across the entire raster operation (got ${laserOnCount})`);

  // 2. Exactly ONE laserOff at the end.
  assert(laserOffCount === 1,
    `exactly ONE laserOff at the end of the raster operation (got ${laserOffCount})`);

  // 3. The laserOn precedes all rapids/linears.
  const firstLaserOnIdx = moves.findIndex(m => m.type === 'laserOn');
  const firstRapidIdx = moves.findIndex(m => m.type === 'rapid');
  const firstLinearIdx = moves.findIndex(m => m.type === 'linear');
  assert(firstLaserOnIdx >= 0 && firstLaserOnIdx < firstRapidIdx,
    `laserOn comes before any rapid (laserOn@${firstLaserOnIdx}, rapid@${firstRapidIdx})`);
  assert(firstLaserOnIdx < firstLinearIdx,
    `laserOn comes before any linear (laserOn@${firstLaserOnIdx}, linear@${firstLinearIdx})`);

  // 4. The laserOff is the last move.
  const lastIdx = moves.length - 1;
  assert(moves[lastIdx].type === 'laserOff',
    `last move is laserOff (got ${moves[lastIdx].type})`);

  // 5. Rapids exist (between scanlines + initial scanline approach) — at least one per scanline.
  assert(rapidCount >= 4,
    `≥4 rapids (one per scanline; row 0,1,2,3 each get one) — got ${rapidCount}`);

  // 6. Power=0 gap-bridge linears appear within scanlines that have multiple segments.
  //    Row 0 has 2 segments (1 gap), row 1 has 3 segments (2 gaps). Row 2 = 1 segment, row 3 = 1.
  //    Minimum gap-bridges expected = 1 + 2 = 3. Actual count includes all velocity-aware splits;
  //    burn-segment splits use power>0, so power=0 linears are exclusively gap-bridges.
  assert(linearZeroPowerCount >= 3,
    `≥3 power=0 linear gap-bridges across the rows (got ${linearZeroPowerCount})`);

  // 7. Burn linears (power>0) exist for the actual segments.
  const burnLinears = moves.filter(m => m.type === 'linear' && (m.power ?? 0) > 0);
  assert(burnLinears.length >= 4,
    `≥4 burn linears across the operation — at minimum one per segment (got ${burnLinears.length})`);

  // 8. The laserOn carries power=0 (M4 S0 modal start, not a power per segment).
  const laserOn = moves.find(m => m.type === 'laserOn');
  assert(laserOn != null && laserOn.type === 'laserOn' && laserOn.power === 0,
    `laserOn declares power=0 (modal start; per-segment S handled inline) — got power=${laserOn?.type === 'laserOn' ? laserOn.power : 'n/a'}`);

  // 9. No interleaved laserOn/laserOff pairs mid-operation. Specifically,
  //    no laserOn appears AFTER a rapid or linear (each segment is NOT
  //    re-armed). We assert "first laserOn is the only laserOn".
  const lastLaserOnIdx = moves.map((m, i) => m.type === 'laserOn' ? i : -1).filter(i => i >= 0).pop() ?? -1;
  assert(firstLaserOnIdx === lastLaserOnIdx,
    `no second laserOn anywhere — pre-T1-31 strategy emitted M4 per segment`);

  // 10. Conversely, no laserOff appears BEFORE the last move.
  const firstLaserOffIdx = moves.findIndex(m => m.type === 'laserOff');
  assert(firstLaserOffIdx === lastIdx,
    `laserOff only at the very end (no per-segment M5 cycling)`);

  // 11. Linear count > 0 (sanity — make sure the test data actually produces burns)
  assert(linearCount > 0, `linear moves exist — pipeline produced at least one G1 (got ${linearCount})`);

  // 12. Source-level pin: T1-31 marker in PlanOptimizer.ts and modal-M4 comment shape
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../src/core/plan/PlanOptimizer.ts'), 'utf-8');
    assert(/T1-31/.test(src), 'T1-31 marker in PlanOptimizer.ts');
    assert(/single planned M4 covers the whole raster operation/.test(src),
      'PlanOptimizer comment documents single planned-M4 modal scope');
    // Pre-T1-31 emitted laserOff + laserOn pairs inside the per-segment
    // loop. The new move iterator emits each only once, outside the
    // scanline segment loop.
    const rasterIteratorFn = src.match(/export function\* iterateRasterOperationMoves[\s\S]*?\n\}/)?.[0] ?? '';
    const laserOnYields = (rasterIteratorFn.match(/yield \{ type: 'laserOn'/g) || []).length;
    const laserOffYields = (rasterIteratorFn.match(/yield \{ type: 'laserOff'/g) || []).length;
    assert(laserOnYields === 1,
      `iterateRasterOperationMoves yields exactly 1 laserOn (got ${laserOnYields})`);
    assert(laserOffYields === 1,
      `iterateRasterOperationMoves yields exactly 1 laserOff (got ${laserOffYields})`);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => { console.error(e); process.exit(1); });
