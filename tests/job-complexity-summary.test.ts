/**
 * T3-72: user-facing job complexity summary.
 *
 * Run: npx tsx tests/job-complexity-summary.test.ts
 */
import { buildJobComplexitySummary } from '../src/app/JobComplexitySummary';
import { createLayer } from '../src/core/scene/Layer';
import { createScene } from '../src/core/scene/Scene';
import { type ImageGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

function imageObject(layerId: string): SceneObject {
  const geometry: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: 1000,
    originalHeight: 500,
    cropX: 0,
    cropY: 0,
    cropWidth: 1000,
    cropHeight: 500,
  };
  return {
    id: generateId(),
    type: 'image',
    name: 'Raster',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function manyCommands(count: number): string {
  return Array.from({ length: count }, (_, index) => `G1 X${index % 100} Y${index % 50}`).join('\n');
}

async function run(): Promise<void> {
console.log('\n=== T3-72 job complexity summary ===\n');

{
  const scene = createScene(400, 300, 'Sparse vector');
  const summary = buildJobComplexitySummary({
    gcodeText: [
      '; comment is ignored',
      'G21',
      '',
      'G0 X0 Y0',
      'G1 X10 Y0 F1000 S200',
      'M5',
    ].join('\n'),
    estimatedTimeSeconds: 42,
    planStats: {
      rapidDistanceMm: 120,
      cutDistanceMm: 80,
      estimatedTimeSeconds: 42,
    },
    scene,
  });

  assert(summary.commandCount === 4, `counts non-comment G-code commands (got ${summary.commandCount})`);
  assert(summary.estimatedTimeLabel === '0:42', `formats short estimate as m:ss (got ${summary.estimatedTimeLabel})`);
  assert(summary.travelDistanceLabel === '120 mm', `formats travel distance (got ${summary.travelDistanceLabel})`);
  assert(summary.burnDistanceLabel === '80 mm', `formats burn distance (got ${summary.burnDistanceLabel})`);
  assert(summary.complexity === 'Low', `sparse vector is Low complexity (got ${summary.complexity})`);
  assert(summary.warnings.length === 0, `sparse vector has no complexity warnings (got ${summary.warnings.length})`);
}

{
  const scene = createScene(400, 300, 'Dense raster');
  const imageLayer = createLayer(0, 'image', 'Photo');
  imageLayer.settings.image.resolution = 600;
  imageLayer.settings.fill.interval = 0.04;
  scene.layers = [imageLayer];
  scene.activeLayerId = imageLayer.id;
  scene.objects = [imageObject(imageLayer.id)];

  const summary = buildJobComplexitySummary({
    gcodeText: manyCommands(100_001),
    planStats: {
      rapidDistanceMm: 12_400,
      cutDistanceMm: 8_200,
      estimatedTimeSeconds: 3_900,
    },
    scene,
  });

  assert(summary.commandCount === 100_001, `dense raster command count is exact (got ${summary.commandCount})`);
  assert(summary.rasterDpiEquivalent === 635, `uses fill spacing DPI equivalent (got ${summary.rasterDpiEquivalent})`);
  assert(summary.fillSpacingLabel === '0.040 mm', `shows smallest fill spacing (got ${summary.fillSpacingLabel})`);
  assert(summary.travelDistanceLabel === '12.4 m', `formats meter-scale travel distance (got ${summary.travelDistanceLabel})`);
  assert(summary.burnDistanceLabel === '8.2 m', `formats meter-scale burn distance (got ${summary.burnDistanceLabel})`);
  assert(summary.complexity === 'High', `dense raster is High complexity (got ${summary.complexity})`);
  assert(
    summary.warnings.some(warning => warning.kind === 'dense-raster') &&
      summary.warnings.some(warning => warning.kind === 'long-job') &&
      summary.warnings.some(warning => warning.kind === 'high-command-count'),
    `dense raster reports density, duration, and command warnings (${summary.warnings.map(w => w.kind).join(',')})`,
  );
}

{
  const scene = createScene(400, 300, 'Mixed');
  const engraveLayer = createLayer(0, 'engrave', 'Engrave fill');
  engraveLayer.settings.fill.enabled = true;
  engraveLayer.settings.fill.interval = 0.1;
  scene.layers = [engraveLayer];
  scene.activeLayerId = engraveLayer.id;
  scene.objects = [{
    id: generateId(),
    type: 'rect',
    name: 'Filled rect',
    layerId: engraveLayer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: { type: 'rect', x: 0, y: 0, width: 40, height: 20, cornerRadius: 0 },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  }];

  const summary = buildJobComplexitySummary({
    gcodeText: manyCommands(20_000),
    planStats: {
      rapidDistanceMm: 950,
      cutDistanceMm: 4_200,
      estimatedTimeSeconds: 1_200,
    },
    scene,
  });

  assert(summary.complexity === 'Medium', `mixed filled job is Medium complexity (got ${summary.complexity})`);
  assert(summary.rasterDpiEquivalent === 254, `0.1 mm fill maps to 254 DPI equivalent (got ${summary.rasterDpiEquivalent})`);
  assert(summary.warnings.length === 0, `medium mixed job has no high-risk warnings (got ${summary.warnings.length})`);
}

{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const panelSource = fs.readFileSync(
    path.resolve(here, '../src/ui/components/connection/ReadyToRunPanel.tsx'),
    'utf-8',
  );
  assert(/Job complexity/.test(panelSource), 'ReadyToRunPanel renders a Job complexity section');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
