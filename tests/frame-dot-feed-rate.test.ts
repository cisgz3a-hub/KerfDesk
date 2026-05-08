/**
 * T3-21: frame-dot feed rate follows the active profile/settings instead of
 * being hardcoded to F3000 everywhere.
 * Run: npx tsx tests/frame-dot-feed-rate.test.ts
 */
import { readFileSync } from 'node:fs';
import { buildFrameGcode } from '../src/app/frameGcode';
import {
  DEFAULT_FRAME_DOT_FEED_RATE,
  createBlankProfile,
  resolveFrameDotFeedRate,
} from '../src/core/devices/DeviceProfile';

const EXPECTED_DEFAULT_FRAME_DOT_FEED_RATE = 3000;

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

function assertIncludes(haystack: string, needle: string, msg: string): void {
  assert(haystack.includes(needle), `${msg} (${needle})`);
}

function assertNotIncludes(haystack: string, needle: string, msg: string): void {
  assert(!haystack.includes(needle), `${msg} (${needle})`);
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

console.log('\n=== frame-dot feed rate ===\n');

{
  const lines = buildFrameGcode([
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ], {
    startMode: 'absolute',
    laserMode: 'dot',
    maxSpindle: 1000,
  });

  assertIncludes(
    lines.join('\n'),
    `F${EXPECTED_DEFAULT_FRAME_DOT_FEED_RATE}`,
    'default frame-dot feed remains 3000 mm/min',
  );
}

{
  const lines = buildFrameGcode([
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ], {
    startMode: 'absolute',
    laserMode: 'dot',
    maxSpindle: 1000,
    frameDotFeedRateMmPerMin: 1200,
  });
  const joined = lines.join('\n');

  assertIncludes(joined, 'G1 X20.000 Y0.000 F1200', 'absolute frame-dot uses custom profile feed rate');
  assertNotIncludes(joined, 'F3000', 'absolute frame-dot no longer ignores custom feed rate');
}

{
  const lines = buildFrameGcode([
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ], {
    startMode: 'current',
    laserMode: 'dot',
    maxSpindle: 1000,
    crosshairAfterFrame: true,
    frameDotFeedRateMmPerMin: 900,
  });
  const joined = lines.join('\n');

  assertIncludes(joined, 'G1 X20.000 Y0.000 F900', 'current frame-dot uses custom profile feed rate');
  assertIncludes(joined, 'G1 X-10.000 Y0.000 F900', 'crosshair frame-dot uses custom profile feed rate');
  assertNotIncludes(joined, 'F3000', 'current/crosshair frame-dot no longer ignores custom feed rate');
}

{
  const profile = createBlankProfile('Feed profile');
  assert(
    DEFAULT_FRAME_DOT_FEED_RATE === EXPECTED_DEFAULT_FRAME_DOT_FEED_RATE,
    'exported default frame-dot feed rate is 3000',
  );
  assert(profile.frameDotFeedRate === EXPECTED_DEFAULT_FRAME_DOT_FEED_RATE, 'new profiles default frame-dot feed rate');
  assert(resolveFrameDotFeedRate(profile) === DEFAULT_FRAME_DOT_FEED_RATE, 'resolver returns profile default');
  assert(resolveFrameDotFeedRate({ ...profile, frameDotFeedRate: 1500 }) === 1500, 'resolver returns custom profile value');
  assert(resolveFrameDotFeedRate({ ...profile, frameDotFeedRate: -1 }) === DEFAULT_FRAME_DOT_FEED_RATE, 'resolver falls back for invalid profile value');
}

{
  const profileSource = read('src/core/devices/DeviceProfile.ts');
  const settingsSource = read('src/ui/components/settings/MachineSettingsTab.tsx');
  const appSource = read('src/ui/components/ConnectionPanelMain.tsx');
  const coordinatorSource = read('src/app/ExecutionCoordinator.ts');
  const controllerSource = read('src/controllers/grbl/GrblController.ts');
  const contractSource = read('src/controllers/ControllerInterface.ts');

  assertIncludes(profileSource, 'frameDotFeedRate', 'device profile persists frame-dot feed rate');
  assertIncludes(settingsSource, "'frameDotFeedRate'", 'settings UI exposes frame-dot feed rate');
  assertIncludes(appSource, 'resolveFrameDotFeedRate(activeProfile)', 'connection panel resolves frame-dot feed from active profile');
  assertIncludes(appSource, 'frameDotFeedRateMmPerMin', 'connection panel passes frame-dot feed to coordinator');
  assertIncludes(coordinatorSource, 'frameDotFeedRateMmPerMin', 'execution coordinator forwards frame-dot feed');
  assertIncludes(controllerSource, 'frameDotFeedRateMmPerMin', 'GRBL controller forwards frame-dot feed');
  assertIncludes(contractSource, 'frameDotFeedRateMmPerMin', 'controller operation contract includes frame-dot feed');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
