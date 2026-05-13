/**
 * T1-224 / F-011: profile and controller capability overrides must be
 * consumed by the production pipeline, not only unit-tested as an isolated
 * helper.
 *
 * Run: npx tsx tests/profile-overrides-wired-to-pipeline.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileGcode,
  profileToControllerCapabilityOverrides,
  resolvePipelineControllerCapabilities,
} from '../src/app/PipelineService';
import { grblCapabilities, type ControllerCapabilities } from '../src/controllers/ControllerCapabilities';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { defaultLaserSettings, type Layer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';

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

function sceneWithRect(): Scene {
  const scene = createScene(300, 200, 'T1-224 capability pipeline');
  const settings = defaultLaserSettings('cut');
  const layer: Layer = {
    id: 'cut',
    name: 'Cut',
    color: '#ff3366',
    visible: true,
    locked: false,
    output: true,
    order: 0,
    settings: {
      ...settings,
      power: { ...settings.power, max: 80 },
    },
  };
  scene.layers = [layer];
  scene.objects = [createRect('cut', 10, 10, 40, 30, 'rect-1')];
  return scene;
}

function maxSValue(gcode: string): number {
  const values = [...gcode.matchAll(/\bS(\d+(?:\.\d+)?)\b/g)]
    .map(match => Number(match[1]))
    .filter(Number.isFinite);
  return Math.max(0, ...values);
}

async function run(): Promise<void> {
  console.log('\n=== T1-224 profile overrides wired to pipeline ===\n');

  const lowPowerCaps: ControllerCapabilities = {
    ...grblCapabilities,
    laser: {
      ...grblCapabilities.laser,
      maxPowerValue: 255,
    },
  };

  {
    const result = await compileGcode(
      sceneWithRect(),
      'absolute',
      null,
      null,
      'grbl',
      null,
      null,
      null,
      { controllerCapabilities: lowPowerCaps },
    );
    const maxS = result ? maxSValue(result.gcode) : -1;
    assert(result != null, 'compileGcode produced output with controller capability override');
    assert(maxS > 0 && maxS <= 255, `controller capability maxPowerValue=255 limits emitted S values (max ${maxS})`);
  }

  {
    const profile = createBlankProfile('T1-224 profile override');
    profile.homingEnabled = false;
    profile.autoFocusSupported = true;
    profile.bedWidth = 620;
    profile.bedHeight = 410;
    profile.maxSpindle = 255;
    const overrides = profileToControllerCapabilityOverrides(profile);
    const resolved = resolvePipelineControllerCapabilities(profile);
    assert(overrides.homingEnabled === false, 'profile mapper carries homingEnabled=false');
    assert(overrides.autofocusSupported === true, 'profile mapper carries autoFocusSupported=true');
    assert(overrides.bedWidthMm === 620 && overrides.bedHeightMm === 410, 'profile mapper carries bed dimensions');
    assert(overrides.maxPowerValue === 255, 'profile mapper carries maxSpindle as maxPowerValue');
    assert(resolved.operations.canHome === false, 'resolved capabilities disable Home from profile override');
    assert(resolved.operations.canAutofocus === true, 'resolved capabilities enable autofocus from profile override');
    assert(resolved.motion.bedWidthMm === 620 && resolved.motion.bedHeightMm === 410, 'resolved capabilities carry profile bed dimensions');
    assert(resolved.laser.maxPowerValue === 255, 'resolved capabilities carry profile max spindle');

    const here = dirname(fileURLToPath(import.meta.url));
    const pipelineSrc = readFileSync(resolve(here, '../src/app/PipelineService.ts'), 'utf-8');
    const cgStart = pipelineSrc.indexOf('export async function compileGcode(');
    const cgEnd = pipelineSrc.indexOf('export async function compileToolpath(');
    const cgBody = pipelineSrc.slice(cgStart, cgEnd);
    const ctBody = pipelineSrc.slice(cgEnd);

    assert(/T1-224/.test(pipelineSrc), 'PipelineService carries T1-224 marker');
    assert(/applyProfileOverrides/.test(pipelineSrc), 'PipelineService imports/uses applyProfileOverrides');
    assert(/profileToControllerCapabilityOverrides/.test(pipelineSrc), 'PipelineService declares profile-to-capability override mapping');
    assert(/resolvePipelineControllerCapabilities/.test(pipelineSrc), 'PipelineService declares a production capability resolver');
    assert(/resolvePipelineControllerCapabilities\(profile,\s*opts\.controllerCapabilities \?\? grblCapabilities\)/.test(cgBody),
      'compileGcode resolves profile-overridden capabilities before output target selection');
    assert(/resolvePipelineControllerCapabilities\(profile,\s*controllerCapabilities\)/.test(ctBody),
      'compileToolpath resolves profile-overridden capabilities before output target selection');
    assert(/controllerCapabilities\.laser\.maxPowerValue/.test(cgBody),
      'compileGcode uses resolved controllerCapabilities.laser.maxPowerValue as the power fallback');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
