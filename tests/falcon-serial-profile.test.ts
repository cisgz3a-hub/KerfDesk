/**
 * Falcon A1 Pro (USB/serial) quick-preset + autofocus field migration.
 * Covers:
 *   1. createFalconSerialProfile() populates all autofocus + Falcon defaults.
 *   2. createFalconSerialProfile() honors a custom display name.
 *   3. getDeviceProfiles() backfills (heals) autofocus fields on a legacy Falcon
 *      profile (brand='Creality', model contains 'Falcon A1 Pro', no AF fields).
 *   4. getDeviceProfiles() also heals an explicit autoFocusSupported=false
 *      (stale; Falcon AF fields are firmware-dictated, not user toggles).
 *
 * Run: npx tsx tests/falcon-serial-profile.test.ts
 */

import {
  backfillFalconAutofocus,
  createFalconSerialProfile,
  getDeviceProfiles,
  initializeDeviceProfiles,
  resetDeviceProfilesForTest,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import { setStorageForTest } from '../src/core/storage/storage';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`      expected: ${String(expected)}`);
    console.error(`      actual:   ${String(actual)}`);
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

function clearMockStorage(): void {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
}

function testFactoryDefaults(): void {
  console.log('\n=== createFalconSerialProfile() defaults ===');
  const p = createFalconSerialProfile();
  assertEq(p.autoFocusSupported, true, 'autoFocusSupported = true');
  assertEq(p.autoFocusCommand, '$HZ1', "autoFocusCommand = '$HZ1'");
  assertEq(p.autoFocusTimeoutMs, 15_000, 'autoFocusTimeoutMs = 15000');
  assertEq(p.brand, 'Creality', "brand = 'Creality'");
  assertEq(p.model, 'Falcon A1 Pro', "model = 'Falcon A1 Pro'");
  assertEq(p.machineType, 'diode', 'machineType = diode');
  assertEq(p.watts, 20, 'watts = 20');
  assertEq(p.bedWidth, 400, 'bedWidth = 400');
  assertEq(p.bedHeight, 400, 'bedHeight = 400');
  assertEq(p.originCorner, 'front-left', 'originCorner = front-left');
  assertEq(p.invertY, true, 'invertY = true (front-origin Y flip)');
  assertEq(p.baudRate, 115200, 'baudRate = 115200');
  assertEq(p.homingEnabled, true, 'homingEnabled = true');
  assertEq(p.softLimitsEnabled, true, 'softLimitsEnabled = true');
  assertEq(p.maxFeedRate, 6000, 'maxFeedRate = 6000');
  assertEq(p.maxSpindle, 1000, 'maxSpindle = 1000');
  assertEq(p.name, 'Creality Falcon A1 Pro', 'default name = Creality Falcon A1 Pro');
  assertEq(p.connection, undefined, 'no connection field (serial/USB discovered at connect time)');
  assertEq(p.allowsNegativeWorkspace, false, 'allowsNegativeWorkspace = false (front-origin default)');
}

function testFactoryCustomName(): void {
  console.log('\n=== createFalconSerialProfile(name) ===');
  const p = createFalconSerialProfile('My Falcon');
  assertEq(p.name, 'My Falcon', 'custom name honored');
  // Factory defaults still present alongside custom name.
  assertEq(p.autoFocusSupported, true, 'autofocus still set with custom name');
  assertEq(p.autoFocusCommand, '$HZ1', 'command still set with custom name');
}

/** Build a stored profile shaped like a pre-autofocus Falcon install. */
function legacyFalconProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  const base: DeviceProfile = {
    id: 'legacy_falcon_1',
    name: 'Creality Falcon A1 Pro',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    machineType: 'diode',
    watts: 20,
    brand: 'Creality',
    model: 'Falcon A1 Pro',
    bedWidth: 400,
    bedHeight: 400,
    originCorner: 'front-left',
    maxFeedRate: 6000,
    maxSpindle: 1000,
    homingEnabled: true,
    softLimitsEnabled: true,
    invertY: true,
    returnToOrigin: true,
    baudRate: 115200,
    startGcode: '',
    endGcode: '',
  };
  return { ...base, ...overrides };
}

function testBackfillHelperPure(): void {
  console.log('\n=== backfillFalconAutofocus() pure helper ===');

  const migrated = backfillFalconAutofocus(legacyFalconProfile());
  assertEq(migrated.autoFocusSupported, true, 'legacy Falcon → autoFocusSupported backfilled true');
  assertEq(migrated.autoFocusCommand, '$HZ1', "legacy Falcon → autoFocusCommand backfilled '$HZ1'");
  assertEq(migrated.autoFocusTimeoutMs, 15_000, 'legacy Falcon → autoFocusTimeoutMs backfilled 15000');

  // Stale `false` from an older build is healed — there is no UI to disable
  // autofocus; the Focus button is firmware-gated, not a preference.
  const healedFalse = backfillFalconAutofocus(
    legacyFalconProfile({ autoFocusSupported: false }),
  );
  assertEq(
    healedFalse.autoFocusSupported,
    true,
    'stale autoFocusSupported=false is healed to true for Falcon A1 Pro',
  );

  const wrongCmd = backfillFalconAutofocus(legacyFalconProfile({ autoFocusCommand: '$MYCUSTOM' }));
  assertEq(wrongCmd.autoFocusCommand, '$HZ1', 'stale or wrong autoFocusCommand is healed to $HZ1');

  const nonFalcon = backfillFalconAutofocus(
    legacyFalconProfile({ brand: 'Other', model: 'Whatever' }),
  );
  assertEq(nonFalcon.autoFocusSupported, undefined, 'non-Falcon profile untouched (supported)');
  assertEq(nonFalcon.autoFocusCommand, undefined, 'non-Falcon profile untouched (command)');

  // Variant model names containing "Falcon A1 Pro" still match.
  const variant = backfillFalconAutofocus(
    legacyFalconProfile({ model: 'Falcon A1 Pro (USB)' }),
  );
  assertEq(variant.autoFocusSupported, true, "model 'Falcon A1 Pro (USB)' still matches");
}

async function testBackfillViaGetDeviceProfiles(): Promise<void> {
  console.log('\n=== getDeviceProfiles() migration on read ===');
  installMockLocalStorage();
  clearMockStorage();
  setStorageForTest(new InMemoryStorageAdapter());
  resetDeviceProfilesForTest();

  const stored = [legacyFalconProfile()];
  memoryStore.laserforge_device_profiles = JSON.stringify(stored);
  memoryStore.laserforge_active_profile = stored[0].id;
  await initializeDeviceProfiles();

  const [migrated] = getDeviceProfiles();
  assertEq(
    migrated.autoFocusSupported,
    true,
    'getDeviceProfiles() backfills autoFocusSupported on legacy Falcon',
  );
  assertEq(
    migrated.autoFocusCommand,
    '$HZ1',
    "getDeviceProfiles() backfills autoFocusCommand = '$HZ1'",
  );
  assertEq(
    migrated.autoFocusTimeoutMs,
    15_000,
    'getDeviceProfiles() backfills autoFocusTimeoutMs = 15000',
  );

  // Stale false (e.g. older build in localStorage) is healed on read.
  clearMockStorage();
  setStorageForTest(new InMemoryStorageAdapter());
  resetDeviceProfilesForTest();
  memoryStore.laserforge_device_profiles = JSON.stringify([
    legacyFalconProfile({ autoFocusSupported: false }),
  ]);
  await initializeDeviceProfiles();
  const [healed] = getDeviceProfiles();
  assertEq(
    healed.autoFocusSupported,
    true,
    'getDeviceProfiles() heals autoFocusSupported=false to true for Falcon A1 Pro',
  );

  // Non-Falcon profile untouched.
  clearMockStorage();
  setStorageForTest(new InMemoryStorageAdapter());
  resetDeviceProfilesForTest();
  memoryStore.laserforge_device_profiles = JSON.stringify([
    legacyFalconProfile({ brand: 'Generic', model: 'Medium Diode' }),
  ]);
  await initializeDeviceProfiles();
  const [generic] = getDeviceProfiles();
  assertEq(
    generic.autoFocusSupported,
    undefined,
    'getDeviceProfiles() does NOT touch non-Falcon profiles',
  );
  assertEq(
    generic.autoFocusCommand,
    undefined,
    'non-Falcon profile command stays undefined',
  );
}

async function runAll(): Promise<void> {
  testFactoryDefaults();
  testFactoryCustomName();
  testBackfillHelperPure();
  await testBackfillViaGetDeviceProfiles();
  setStorageForTest(null);
  console.log(`\nFalcon serial profile tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void runAll().catch((e: unknown) => {
  setStorageForTest(null);
  console.error(e);
  process.exit(1);
});
