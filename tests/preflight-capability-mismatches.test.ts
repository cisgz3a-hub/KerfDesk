/**
 * T3-57: pin the profile-vs-live capability mismatch rules.
 *
 * Run: npx tsx tests/preflight-capability-mismatches.test.ts
 */

import {
  checkCapabilityMismatches,
  hasCapabilityMismatchError,
  type CapabilityMismatchCode,
  type CapabilityMismatchFinding,
} from '../src/core/preflight/rules/CapabilityMismatchRules';
import { runPreflight } from '../src/core/preflight/Preflight';
import { createScene } from '../src/core/scene/Scene';
import type { DeviceIdentity } from '../src/controllers/ControllerInterface';
import type { DeviceProfile } from '../src/core/devices/DeviceProfile';

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

function profile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    id: 'p',
    name: 'Test',
    createdAt: '2026-05-10T00:00:00Z',
    updatedAt: '2026-05-10T00:00:00Z',
    machineType: 'diode',
    watts: 20,
    brand: 'Creality',
    model: 'Falcon A1 Pro',
    bedWidth: 400,
    bedHeight: 300,
    originCorner: 'front-left',
    maxFeedRate: 6000,
    maxRateX: 6000,
    maxRateY: 6000,
    maxAccelX: 800,
    maxAccelY: 800,
    maxSpindle: 1000,
    homingEnabled: true,
    softLimitsEnabled: false,
    invertY: false,
    returnToOrigin: true,
    baudRate: 115200,
    startGcode: '',
    endGcode: '',
    ...overrides,
  };
}

function identity(overrides: Partial<DeviceIdentity> = {}): DeviceIdentity {
  return {
    firmwareVersion: '1.1h.20221128',
    buildOptions: 'VL,15,128',
    maxSpindle: 1000,
    bedWidthMm: 400,
    bedHeightMm: 300,
    homingDirection: 0,
    homingEnabled: true,
    laserMode: true,
    maxRateXMmPerMin: 6000,
    maxRateYMmPerMin: 6000,
    maxAccelXMmPerS2: 800,
    maxAccelYMmPerS2: 800,
    ...overrides,
  };
}

function hasCode(
  findings: readonly CapabilityMismatchFinding[],
  code: CapabilityMismatchCode,
): boolean {
  return findings.some((f) => f.code === code);
}

console.log('\n=== T3-57 capability mismatch rules ===\n');

void (async () => {
  // 1. Matching profile + identity → no findings.
  {
    const f = checkCapabilityMismatches(profile(), identity());
    assert(f.length === 0, 'Match: no findings emitted');
    assert(hasCapabilityMismatchError(f) === false, 'Match: no error-severity finding');
  }

  // 2. Profile expects homing, firmware reports $22=0 → error.
  {
    const f = checkCapabilityMismatches(
      profile({ homingEnabled: true }),
      identity({ homingEnabled: false }),
    );
    assert(hasCode(f, 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH'), 'Homing: error code emitted');
    const issue = f.find((x) => x.code === 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH')!;
    assert(issue.severity === 'error', 'Homing: severity error');
    assert(/\$22|homing/i.test(issue.message), 'Homing: message names $22 or homing');
    assert(/\$22|homing/i.test(issue.fix), 'Homing: fix names $22 or homing');
    assert(issue.path === 'profile.homingEnabled', 'Homing: path points at profile.homingEnabled');
    assert(hasCapabilityMismatchError(f) === true, 'Homing: hasError true');
  }

  // 3. Profile homing disabled + firmware $22=0 → no error (matches).
  {
    const f = checkCapabilityMismatches(
      profile({ homingEnabled: false }),
      identity({ homingEnabled: false }),
    );
    assert(!hasCode(f, 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH'), 'Homing match (both off): no error');
  }

  // 4. Firmware homingEnabled null → skipped (cannot compare).
  {
    const f = checkCapabilityMismatches(
      profile({ homingEnabled: true }),
      identity({ homingEnabled: null }),
    );
    assert(!hasCode(f, 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH'), 'Homing null on firmware: skipped');
  }

  // 5. Profile X feed exceeds firmware $110 → warning.
  {
    const f = checkCapabilityMismatches(
      profile({ maxRateX: 10000 }),
      identity({ maxRateXMmPerMin: 6000 }),
    );
    const issue = f.find((x) => x.code === 'PROFILE_FEED_X_EXCEEDS_FIRMWARE');
    assert(issue !== undefined, 'Feed X: warning emitted');
    assert(issue?.severity === 'warning', 'Feed X: severity warning');
    assert(/10000.*6000/.test(issue?.message ?? ''), 'Feed X: message shows profile-vs-firmware values');
  }

  // 6. Profile Y feed at-or-below firmware → no warning.
  {
    const f = checkCapabilityMismatches(
      profile({ maxRateY: 5000 }),
      identity({ maxRateYMmPerMin: 6000 }),
    );
    assert(!hasCode(f, 'PROFILE_FEED_Y_EXCEEDS_FIRMWARE'), 'Feed Y: no warning when profile <= firmware');
  }

  // 7. Profile X accel exceeds firmware $120 → warning.
  {
    const f = checkCapabilityMismatches(
      profile({ maxAccelX: 1500 }),
      identity({ maxAccelXMmPerS2: 800 }),
    );
    assert(hasCode(f, 'PROFILE_ACCEL_X_EXCEEDS_FIRMWARE'), 'Accel X: warning emitted');
    const issue = f.find((x) => x.code === 'PROFILE_ACCEL_X_EXCEEDS_FIRMWARE');
    assert(issue?.severity === 'warning', 'Accel X: severity warning');
  }

  // 8. Profile Y accel exceeds firmware → warning.
  {
    const f = checkCapabilityMismatches(
      profile({ maxAccelY: 2000 }),
      identity({ maxAccelYMmPerS2: 800 }),
    );
    assert(hasCode(f, 'PROFILE_ACCEL_Y_EXCEEDS_FIRMWARE'), 'Accel Y: warning emitted');
  }

  // 9. Profile bed width exceeds firmware → warning.
  {
    const f = checkCapabilityMismatches(
      profile({ bedWidth: 500 }),
      identity({ bedWidthMm: 400 }),
    );
    assert(hasCode(f, 'PROFILE_BED_WIDTH_EXCEEDS_FIRMWARE'), 'Bed width: warning emitted');
    const issue = f.find((x) => x.code === 'PROFILE_BED_WIDTH_EXCEEDS_FIRMWARE');
    assert(issue?.severity === 'warning', 'Bed width: severity warning');
    assert(/soft-limit|alarm/i.test(issue?.message ?? ''), 'Bed width: message names soft-limit alarm risk');
  }

  // 10. Profile bed height exceeds firmware → warning.
  {
    const f = checkCapabilityMismatches(
      profile({ bedHeight: 400 }),
      identity({ bedHeightMm: 300 }),
    );
    assert(hasCode(f, 'PROFILE_BED_HEIGHT_EXCEEDS_FIRMWARE'), 'Bed height: warning emitted');
  }

  // 11. Profile bed at-or-below firmware → no warning. (The reverse
  //     case — firmware reports a larger bed than the profile thinks —
  //     is not flagged; the profile is the lower bound the user
  //     authored, and a larger physical bed isn't a problem at job
  //     start.)
  {
    const f = checkCapabilityMismatches(
      profile({ bedWidth: 300, bedHeight: 200 }),
      identity({ bedWidthMm: 400, bedHeightMm: 300 }),
    );
    assert(!hasCode(f, 'PROFILE_BED_WIDTH_EXCEEDS_FIRMWARE'), 'Smaller profile bed: no width warning');
    assert(!hasCode(f, 'PROFILE_BED_HEIGHT_EXCEEDS_FIRMWARE'), 'Smaller profile bed: no height warning');
  }

  // 12. Identity feed/accel/bed null → skipped (cannot compare).
  {
    const f = checkCapabilityMismatches(
      profile({ maxRateX: 10000, bedWidth: 500 }),
      identity({ maxRateXMmPerMin: null, bedWidthMm: null }),
    );
    assert(!hasCode(f, 'PROFILE_FEED_X_EXCEEDS_FIRMWARE'), 'Null firmware feed: skipped');
    assert(!hasCode(f, 'PROFILE_BED_WIDTH_EXCEEDS_FIRMWARE'), 'Null firmware bed: skipped');
  }

  // 13. 1.0-unit slack — profile 6001 vs firmware 6000 should not
  //     warn (firmware float rounding tolerance).
  {
    const f = checkCapabilityMismatches(
      profile({ maxRateX: 6001 }),
      identity({ maxRateXMmPerMin: 6000 }),
    );
    assert(!hasCode(f, 'PROFILE_FEED_X_EXCEEDS_FIRMWARE'), '1.0-unit slack: no warning');
  }

  // 14. Mixed: feed warning + homing error → both surfaced; hasError true.
  {
    const f = checkCapabilityMismatches(
      profile({ homingEnabled: true, maxRateX: 9000 }),
      identity({ homingEnabled: false, maxRateXMmPerMin: 6000 }),
    );
    assert(hasCode(f, 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH'), 'Mixed: homing error present');
    assert(hasCode(f, 'PROFILE_FEED_X_EXCEEDS_FIRMWARE'), 'Mixed: feed warning present');
    assert(hasCapabilityMismatchError(f) === true, 'Mixed: hasError true (error wins for the predicate)');
    assert(f.length === 2, 'Mixed: both findings present');
  }

  // 15. Source pin: T3-57 marker + additive-only.
  {
    const results = runPreflight({
      scene: createScene(400, 300, 'Capability mismatch preflight integration'),
      profile: profile({ maxRateX: 9000, bedWidth: 500 }),
      optimizeOrderEnabled: true,
      liveMachineInfo: {
        deviceIdentity: identity({
          maxRateXMmPerMin: 6000,
          bedWidthMm: 400,
        }),
      },
      preflightBedWidthMm: 400,
      preflightBedHeightMm: 300,
    });
    assert(
      results.some((r) => r.code === 'PROFILE_FEED_X_EXCEEDS_FIRMWARE' && r.severity === 'warning'),
      'Preflight integration surfaces profile X feed exceeding firmware $110',
    );
    assert(
      results.some((r) => r.code === 'PROFILE_BED_WIDTH_EXCEEDS_FIRMWARE' && r.severity === 'warning'),
      'Preflight integration surfaces profile bed width exceeding firmware $130',
    );
  }

  // 16. Source pin: T3-57 marker + additive-only.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const moduleSrc = fs.readFileSync(
      path.resolve(here, '../src/core/preflight/rules/CapabilityMismatchRules.ts'),
      'utf-8',
    );

    assert(/T3-57/.test(moduleSrc), 'Source: T3-57 marker present in module');
    assert(
      /import\s+type\s+\{\s*DeviceIdentity\s*\}/.test(moduleSrc),
      'Source: DeviceIdentity imported as type-only',
    );
    assert(
      /import\s+type\s+\{\s*DeviceProfile\s*\}/.test(moduleSrc),
      'Source: DeviceProfile imported as type-only',
    );
  }

  console.log(`\nT3-57 capability mismatches: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
