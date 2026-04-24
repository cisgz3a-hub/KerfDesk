/**
 * Guardrails: autosave preserves image data (Storage-backed), remains loadable; compact JSON vs pretty file save.
 * Run: npx tsx tests/autosave-serialization.test.ts
 */

import { serializeScene, serializeForAutosave, deserializeScene } from '../src/io/SceneSerializer';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { type SceneObject, type ImageGeometry } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
import { createRect } from '../src/core/scene/SceneObject';
import { createLayer } from '../src/core/scene/Layer';
import { compileJob } from '../src/core/job/JobCompiler';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { applyMachineTransform } from '../src/core/plan/MachineTransform';
import { getOutputStrategy } from '../src/core/output/Output';
import { runPreflightSummary } from '../src/core/preflight/Preflight';
import '../src/core/output/GrblStrategy';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function makeImageObject(layerId: string, pixels: number): SceneObject {
  const w = 80;
  const h = Math.max(1, Math.floor(pixels / w));
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
    transform: { ...IDENTITY_MATRIX, tx: 5, ty: 5 },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

console.log('\n=== Autosave serialization guardrails ===');

const base = createScene(400, 300, 'Autosave Test');
const lid = base.layers[0].id;
const withImage = addObject(addObject(base, makeImageObject(lid, 80 * 60)), makeImageObject(lid, 80 * 60));

const fullJson = serializeScene(withImage);
const autoJson = serializeForAutosave(withImage);

assert(JSON.parse(autoJson).format === 'laserforge', 'autosave: valid envelope format');
assert(JSON.parse(autoJson).scene?.objects?.length === 2, 'autosave: two objects preserved');

assert(!autoJson.includes('"grayscaleData":{'), 'autosave: no raw grayscaleData object blob in JSON');
assert(!autoJson.includes('"adjustedData":{'), 'autosave: no raw adjustedData object blob in JSON');
assert(autoJson.includes('_grayscaleDataB64'), 'autosave: encodes grayscale as b64');
assert(autoJson.includes('_adjustedDataB64'), 'autosave: encodes adjusted as b64');

assert(
  fullJson.includes('_grayscaleDataB64') || fullJson.includes('grayscaleData'),
  'full save: still carries image payload (b64 or array)',
);

const ratio = autoJson.length / fullJson.length;
assert(ratio < 1, `autosave compact not larger than pretty full save (ratio ${(ratio * 100).toFixed(1)}%)`);
assert(autoJson.length < fullJson.length, 'autosave byte length strictly less than pretty-printed full save');

let loaded: ReturnType<typeof deserializeScene> | null = null;
try {
  loaded = deserializeScene(autoJson);
  assert(true, 'deserialize autosave: does not throw');
} catch {
  assert(false, 'deserialize autosave: does not throw');
}

if (loaded) {
  assert(loaded.objects.length === 2, 'roundtrip: object count');
  assert(loaded.objects.every(o => o.type === 'image'), 'roundtrip: both remain images');
  assert(
    loaded.objects.every(o => {
      const g = o.geometry as ImageGeometry;
      return g.type === 'image' && g.src.includes('data:image');
    }),
    'roundtrip: image src preserved',
  );
  assert(
    loaded.objects.every(o => {
      const g = o.geometry as ImageGeometry;
      return g.grayscaleData instanceof Uint8Array && g.grayscaleData.length > 0
        && g.adjustedData instanceof Uint8Array && g.adjustedData.length > 0;
    }),
    'roundtrip: pixel buffers restored from autosave',
  );
}

const rectOnly = addObject(base, createRect(lid, 12, 12, 30, 20));
const autoRect = serializeForAutosave(rectOnly);
const fullRect = serializeScene(rectOnly);
assert(JSON.parse(autoRect).scene.objects.length === 1, 'rect scene autosave: one object');
assert(deserializeScene(autoRect).objects[0].type === 'rect', 'rect autosave roundtrip');

assert(
  autoRect.length <= fullRect.length * 1.05,
  'rect-only autosave not larger than full (no image bloat)',
);

const huge = addObject(base, makeImageObject(lid, 200 * 200));
const autoH = serializeForAutosave(huge);
const fullH = serializeScene(huge);
assert(autoH.length < fullH.length, 'large image: compact autosave smaller than pretty full save');

// Compile-equivalence guardrail (vectors survive autosave unchanged)
const vectorScene = createScene(300, 200, 'Vector Eq');
const vectorLayerId = vectorScene.layers[0].id;
const vectorWithRect = addObject(vectorScene, createRect(vectorLayerId, 15, 25, 55, 35));
const fullVector = deserializeScene(serializeScene(vectorWithRect));
const autosavedVector = deserializeScene(serializeForAutosave(vectorWithRect));

const fullVectorJob = compileJob(fullVector);
const autoVectorJob = compileJob(autosavedVector);
assert(fullVectorJob.operations.length === autoVectorJob.operations.length, 'compile eq: operation count stable after autosave');

const fullVectorPlan = optimizePlan(fullVectorJob);
const autoVectorPlan = optimizePlan(autoVectorJob);
assert(fullVectorPlan.operations.length === autoVectorPlan.operations.length, 'compile eq: plan operation count stable');

const fullMachine = applyMachineTransform(fullVectorPlan, {
  startMode: 'current',
  savedOrigin: null,
  originCorner: 'front-left',
  bedHeightMm: vectorScene.canvas.height,
});
const autoMachine = applyMachineTransform(autoVectorPlan, {
  startMode: 'current',
  savedOrigin: null,
  originCorner: 'front-left',
  bedHeightMm: vectorScene.canvas.height,
});

const grbl = getOutputStrategy('grbl');
assert(!!grbl, 'compile eq: GRBL strategy registered');
if (grbl) {
  const normalize = (g: string) =>
    g
      .split('\n')
      .filter(line => !line.startsWith('; Date: '))
      .join('\n');

  const fullGcode = grbl.generate(fullMachine.plan, fullVectorJob, { returnPosition: null }).text ?? '';
  const autoGcode = grbl.generate(autoMachine.plan, autoVectorJob, { returnPosition: null }).text ?? '';

  assert(fullGcode.length > 0, 'compile eq: full scene produces gcode');
  assert(autoGcode.length > 0, 'compile eq: autosave scene produces gcode');
  assert(normalize(fullGcode) === normalize(autoGcode), 'compile eq: autosave vector output matches full output');
}

// Crash-recovery image guardrail: missing pixel buffers should block start (not silently engrave nothing)
const rasterScene = createScene(300, 200, 'Raster Missing Data');
const rasterLayer = createLayer(1, 'image', 'Image');
rasterScene.layers.push(rasterLayer);
const missingDataImage = makeImageObject(rasterLayer.id, 64 * 64);
const g = missingDataImage.geometry as ImageGeometry;
delete g.adjustedData;
delete g.grayscaleData;
delete g.grayscaleWidth;
delete g.grayscaleHeight;
rasterScene.objects.push(missingDataImage);

const recoveredRaster = deserializeScene(serializeForAutosave(rasterScene));
const recoveredJob = compileJob(recoveredRaster);
assert(recoveredJob.operations.length === 0, 'recovered raster with missing data compiles to no operations');

const machineIdle = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
} as const;
const preflight = runPreflightSummary(recoveredRaster, null, machineIdle, 300, 200, null);
assert(preflight.canStart === false, 'preflight blocks recovered image with missing raster data');
assert(
  preflight.issues.some(i => i.id.startsWith('design-image-missing-raster-data-') && i.severity === 'blocker'),
  'preflight reports explicit missing image raster-data blocker',
);

console.log(`\nAutosave serialization: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
