/**
 * PRT4040 router-laser profile defaults.
 *
 * The PRT4040 is a CNC-router style GRBL machine with a laser attachment,
 * not a Falcon-style diode gantry. Its safe first-run posture is manual
 * zeroing: no app Home button, no automatic return move, and no autofocus.
 *
 * Run: npx tsx tests/prt4040-router-laser-profile.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import {
  createPrt4040RouterLaserProfile,
  shouldDefaultStartModeToCurrentForProfile,
} from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { defaultLaserSettings } from '../src/core/scene/Layer';
import { createRect } from '../src/core/scene/SceneObject';
import type { Layer } from '../src/core/scene/Layer';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

console.log('\n=== PRT4040 router-laser profile ===\n');

async function run(): Promise<void> {
  const profile = createPrt4040RouterLaserProfile();

  assertEq(profile.brand, 'PRTCNC', 'brand is PRTCNC');
  assertEq(profile.model, 'PRT4040 router + laser', 'model names the router-laser profile');
  assertEq(profile.bedWidth, 400, 'bedWidth defaults to 400mm');
  assertEq(profile.bedHeight, 400, 'bedHeight defaults to 400mm');
  assertEq(profile.originCorner, 'rear-right', 'originCorner defaults to rear-right');
  assertEq(profile.invertY, false, 'invertY false for rear-origin mapping');
  assertEq(profile.homingEnabled, false, 'homing disabled by default');
  assertEq(profile.softLimitsEnabled, false, 'soft limits disabled until homing is verified');
  assertEq(profile.returnToOrigin, false, 'post-job return disabled by default');
  assertEq(profile.autoFocusSupported, false, 'autofocus hidden for router profile');
  assertEq(profile.maxFeedRate, 1500, 'maxFeedRate conservative for router mechanics');
  assertEq(profile.maxSpindle, 1000, 'maxSpindle defaults to GRBL 1000');
  assertEq(profile.allowsNegativeWorkspace, true, 'negative workspace allowed for CNC-router coordinates');
  assertEq(profile.allowUnverifiedWcsStart, true, 'manual-zero profile can start when WCS verification is unavailable');
  assert(shouldDefaultStartModeToCurrentForProfile(profile), 'profile defaults/nudges start mode to current/head mode');

  const scene = createScene(400, 400, 'prt4040 stay-put compile');
  const layer: Layer = {
    id: 'L1',
    name: 'Cut',
    color: '#ff3366',
    visible: true,
    locked: false,
    output: true,
    order: 0,
    settings: defaultLaserSettings('cut'),
  };
  scene.layers = [layer];
  scene.objects = [createRect('L1', 20, 20, 40, 20, 'rect-prt')];

  const result = await compileGcode(scene, 'current', null, null, 'grbl', null, null, profile);
  assert(result != null, 'compileGcode returns output for PRT4040 profile');
  const gcode = result?.gcode ?? '';
  assert(gcode.includes('; head stays at last position'), 'returnToOrigin=false emits stay-in-place footer');
  assert(!/G0 X0(?:\.000)? Y0(?:\.000)? ; return to origin/.test(gcode), 'no post-job G0 return-to-origin move');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch(err => {
  failed++;
  console.error(err);
  process.exit(1);
});
