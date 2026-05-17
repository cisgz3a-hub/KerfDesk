/**
 * S25-07-002: Z-step job moves must be blocked unless the active
 * profile explicitly declares safe, bounded Z-axis travel.
 *
 * Run: npx tsx tests/preflight-z-axis-bounds.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankProfile, type DeviceProfile } from '../src/core/devices/DeviceProfile';
import { createEmptyJob, type Job } from '../src/core/job/Job';
import { type Plan } from '../src/core/plan/Plan';
import { runPreflight, type PreflightContext } from '../src/core/preflight/Preflight';
import { getOutputStrategy } from '../src/core/output/Output';
import '../src/core/output/GrblStrategy';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function makeProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return { ...createBlankProfile('S25-07-002 profile'), bedWidth: 300, bedHeight: 300, ...overrides };
}

function makeSceneWithZStep(zStepPerPass: number, passes = 3): Scene {
  const scene = createScene(300, 300, 'S25-07-002 scene');
  const layer = scene.layers[0];
  layer.settings.mode = 'cut';
  layer.settings.power.max = 80;
  layer.settings.speed = 1000;
  layer.settings.passes = passes;
  layer.settings.zStepPerPass = zStepPerPass;
  scene.objects = [createRect(layer.id, 10, 10, 20, 20, 'Z-step cut')];
  return scene;
}

function makeCtx(scene: Scene, profile: DeviceProfile): PreflightContext {
  return {
    scene,
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: profile.bedWidth,
    preflightBedHeightMm: profile.bedHeight,
  };
}

function hasCode(scene: Scene, profile: DeviceProfile, code: string): boolean {
  return runPreflight(makeCtx(scene, profile)).some(result => result.code === code);
}

console.log('\n=== S25-07-002 Z-axis preflight bounds ===\n');

{
  const scene = makeSceneWithZStep(-1, 3);
  const profile = makeProfile();
  assert(
    hasCode(scene, profile, 'Z_AXIS_UNSUPPORTED'),
    'non-zero zStepPerPass is blocked when profile has no explicit Z-axis support',
  );
}

{
  const scene = makeSceneWithZStep(-1, 3);
  const profile = makeProfile({ zAxis: { supported: true } });
  assert(
    hasCode(scene, profile, 'Z_AXIS_LIMITS_MISSING'),
    'Z-supported profiles still require explicit safe Z min/max limits',
  );
}

{
  const scene = makeSceneWithZStep(-2, 3);
  const profile = makeProfile({ zAxis: { supported: true, minMm: -2, maxMm: 0 } });
  assert(
    hasCode(scene, profile, 'Z_AXIS_OUT_OF_RANGE'),
    'zStepPerPass is rejected when a later pass would exceed configured safe Z travel',
  );
}

{
  const scene = makeSceneWithZStep(-1, 3);
  const profile = makeProfile({ zAxis: { supported: true, minMm: -2, maxMm: 0 } });
  assert(
    !hasCode(scene, profile, 'Z_AXIS_UNSUPPORTED') &&
      !hasCode(scene, profile, 'Z_AXIS_LIMITS_MISSING') &&
      !hasCode(scene, profile, 'Z_AXIS_OUT_OF_RANGE'),
    'in-range Z-step passes when explicit Z support and safe limits are configured',
  );
}

{
  const scene = makeSceneWithZStep(0, 3);
  const profile = makeProfile();
  assert(
    !hasCode(scene, profile, 'Z_AXIS_UNSUPPORTED'),
    'zero zStepPerPass remains allowed on profiles without Z-axis support',
  );
}

{
  const job: Job = createEmptyJob('S25-07-002 output', 'project-z');
  job.operations.push({
    id: 'op-z',
    layerId: 'layer-z',
    layerName: 'Z Layer',
    layerColor: '#ffffff',
    order: 0,
    type: 'cut',
    settings: {
      powerMin: 0,
      powerMax: 80,
      speed: 1000,
      passes: 2,
      zStepPerPass: -1,
      fillInterval: 0,
      fillAngle: 0,
      fillMode: 'line',
      fillBiDirectional: false,
      overscanning: 0,
      overcut: 0,
      leadIn: 0,
      tabCount: 0,
      tabWidth: 0,
      insideFirst: true,
      airAssist: false,
      accelAwarePower: false,
      maxAccelMmPerS2: 500,
      minPowerRatioAccel: 0.1,
      scanningOffsets: EMPTY_OFFSET_TABLE,
    },
    geometry: { type: 'vector', paths: [] },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  });
  const plan: Plan = {
    id: 'plan-z',
    jobId: job.id,
    createdAt: '2026-05-17T00:00:00.000Z',
    operations: [{
      operationId: 'op-z',
      layerName: 'Z Layer',
      layerColor: '#ffffff',
      passIndex: 1,
      moves: [{ type: 'setZ', z: -1 }],
    }],
    stats: {
      totalDistanceMm: 0,
      rapidDistanceMm: 0,
      cutDistanceMm: 0,
      estimatedTimeSeconds: 0,
      moveCount: 1,
      operationCount: 1,
      passCount: 2,
    },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  };
  const strategy = getOutputStrategy('grbl');
  const text = strategy?.generate(plan, job, { startMode: 'absolute' }).text ?? '';
  assert(text.includes('G0 Z-1.000'), 'valid in-range Z output still emits the same absolute G0 Z move');
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const preflightSource = readFileSync(
    resolve(here, '../src/core/preflight/rules/LayerSettingsPreflight.ts'),
    'utf8',
  );
  assert(/S25-07-002/.test(preflightSource), 'LayerSettingsPreflight carries the S25-07-002 marker');
  assert(/Z_AXIS_UNSUPPORTED/.test(preflightSource), 'preflight has an explicit unsupported-Z blocker');
}

console.log(`\nS25-07-002 Z-axis preflight tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
