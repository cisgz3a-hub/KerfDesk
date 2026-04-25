/**
 * T1-13: GRBL M4 firmware dynamic power must disable software splitting.
 * Run: npx tsx tests/raster-m4-no-software-splitting.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import { compileJob } from '../src/core/job/JobCompiler';
import { createBlankProfile, saveDeviceProfile, setActiveProfileId } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type ImageGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

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

function makeRasterScene(): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'M4Raster');
  const rasterLayer = createLayer(0, 'image', 'Raster');
  rasterLayer.settings.speed = 6000;
  rasterLayer.settings.powerMin = 20;
  rasterLayer.settings.powerMax = 80;
  rasterLayer.settings.accelAwarePower = true;
  scene.layers = [rasterLayer];
  scene.activeLayerId = rasterLayer.id;
  const w = 16;
  const h = 8;
  const adjusted = new Uint8Array(w * h);
  for (let i = 0; i < adjusted.length; i++) adjusted[i] = i % 255;
  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: w,
    originalHeight: h,
    cropX: 0,
    cropY: 0,
    cropWidth: w,
    cropHeight: h,
    grayscaleData: new Uint8Array(w * h).fill(127),
    grayscaleWidth: w,
    grayscaleHeight: h,
    adjustedData: adjusted,
  };
  const img: SceneObject = {
    id: generateId(),
    type: 'image',
    name: 'img',
    layerId: rasterLayer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 10, ty: 10 },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [img];
  return scene;
}

function normalizeGcode(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.startsWith('; Date: '))
    .join('\n');
}

void (async () => {
  console.log('\n=== raster M4: no software splitting ===\n');
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('T1-13');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  profile.accelAwarePower = true;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  const scene = makeRasterScene();

  const jobNoDynamic = compileJob(scene, {
    machineAccelMmPerS2: 1000,
    strategySupportsDynamicLaserPower: false,
  });
  const rasterNoDynamic = jobNoDynamic.operations.find(op => op.type === 'raster');
  assert(!!rasterNoDynamic, 'raster op exists without dynamic capability');
  assert(
    rasterNoDynamic?.settings.accelAwarePower === true,
    'without dynamic capability, accelAwarePower remains user-requested true',
  );

  const jobDynamic = compileJob(scene, {
    machineAccelMmPerS2: 1000,
    strategySupportsDynamicLaserPower: true,
  });
  const rasterDynamic = jobDynamic.operations.find(op => op.type === 'raster');
  assert(!!rasterDynamic, 'raster op exists with dynamic capability');
  assert(
    rasterDynamic?.settings.accelAwarePower === false,
    'with dynamic capability, accelAwarePower is forced false',
  );

  profile.accelAwarePower = true;
  saveDeviceProfile(profile);
  const compiledTrue = await compileGcode(scene, 'current', null, null, 'grbl', null, 1000);
  profile.accelAwarePower = false;
  saveDeviceProfile(profile);
  const compiledFalse = await compileGcode(scene, 'current', null, null, 'grbl', null, 1000);

  assert(compiledTrue != null && compiledFalse != null, 'compileGcode succeeds in both modes');
  if (compiledTrue && compiledFalse) {
    assert(
      normalizeGcode(compiledTrue.gcode) === normalizeGcode(compiledFalse.gcode),
      'GRBL M4 output is identical whether profile accelAwarePower is true or false',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

