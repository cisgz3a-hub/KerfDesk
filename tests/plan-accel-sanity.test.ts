/**
 * resolveMaxAccelMmPerS2 + JobCompiler path — clip controller/profile accel to plausible range.
 * Run: npx tsx tests/plan-accel-sanity.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type SceneObject, type ImageGeometry } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
import { compileJob, resolveMaxAccelMmPerS2 } from '../src/core/job/JobCompiler';
import { createBlankProfile, type DeviceProfile } from '../src/core/devices/DeviceProfile';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const memoryStore: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      const keys = Object.keys(memoryStore);
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function setActiveProfile(profile: DeviceProfile): void {
  memoryStore.laserforge_device_profiles = JSON.stringify([profile]);
  memoryStore.laserforge_active_profile = profile.id;
}

function makeImageObject(layerId: string): SceneObject {
  const w = 8;
  const h = 8;
  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: w,
    originalHeight: h,
    cropX: 0,
    cropY: 0,
    cropWidth: w,
    cropHeight: h,
    grayscaleData: new Uint8Array(w * h).fill(128),
    grayscaleWidth: w,
    grayscaleHeight: h,
    adjustedData: new Uint8Array(w * h).fill(64),
  };
  return {
    id: generateId(),
    type: 'image',
    name: 'Img',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 0, ty: 0 },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

console.log('\n=== resolveMaxAccelMmPerS2 (sanity bounds) ===');

{
  const r = resolveMaxAccelMmPerS2(5, 2000);
  assert(r.value === 2000 && !r.warnImplausibleController, 'low controller (5) + profile 2000 → 2000');
}
{
  const r = resolveMaxAccelMmPerS2(200_000, 2000);
  assert(r.value === 2000 && !r.warnImplausibleController, 'high controller + good profile → profile');
}
{
  const r = resolveMaxAccelMmPerS2(Number.NaN, 2000);
  assert(r.value === 2000 && !r.warnImplausibleController, 'NaN controller + profile 2000 → 2000');
}
{
  const r = resolveMaxAccelMmPerS2(1500, 500);
  assert(r.value === 1500 && !r.warnImplausibleController, 'plausible controller wins (1500 vs 500 profile)');
}
{
  const r = resolveMaxAccelMmPerS2(5, 50);
  assert(r.value === 1000, 'both implausible (5, 50) → 1000 default');
  assert(
    r.warnImplausibleController && r.ignoredDetected === 5,
    'flags implausible controller (profile also bad)',
  );
}
{
  const r = resolveMaxAccelMmPerS2(null, undefined);
  assert(r.value === 1000 && !r.warnImplausibleController, 'null / undefined → 1000, no warn');
}
{
  const r = resolveMaxAccelMmPerS2(1500, undefined);
  assert(r.value === 1500 && !r.warnImplausibleController, 'plausible controller, no profile → 1500');
}
{
  const r = resolveMaxAccelMmPerS2(null, 8000);
  assert(r.value === 8000 && !r.warnImplausibleController, 'no machine accel, plausible profile 8000');
}

console.log('\n=== JobCompiler: console.warn on bad controller, no good profile ===');
{
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  installMockLocalStorage();
  const p = createBlankProfile('accel-sanity');
  p.maxAccelMmPerS2 = 50;
  setActiveProfile(p);
  const scene = createScene(200, 200, 'T');
  const L = createLayer(0, 'image', 'Raster');
  scene.layers = [L];
  scene.activeLayerId = L.id;
  scene.objects = [makeImageObject(L.id)];
  scene.compileOptions = { optimizeOrder: false };
  const warnSpy: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    warnSpy.push(
      a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '),
    );
  };
  let job: ReturnType<typeof compileJob>;
  try {
    job = compileJob(scene, { machineAccelMmPerS2: 5, optimizeOrder: false });
  } finally {
    console.warn = orig;
  }
  const rOp = job.operations.find((o) => o.geometry.type === 'raster');
  assert(!!rOp, 'raster op exists');
  if (rOp) assert(rOp.settings.maxAccelMmPerS2 === 1000, 'settings use 1000 default when both accels bad');
  assert(
    warnSpy.some((m) => m.includes('[JobCompiler]') && m.includes('5') && m.includes('implausible acceleration')),
    'JobCompiler console.warn for implausible 5 with profile 50',
  );
  assert(
    warnSpy.some((m) => m.includes('1000') && m.includes('mm/s²')),
    'warning mentions default 1000',
  );
}

if (failed > 0) process.exit(1);
process.stdout.write(`\nPlan accel sanity: ${passed} passed\n`);
