/**
 * DeviceProfile synchronous API over cached storage.
 * Run: npx tsx tests/device-profile-basic-api.test.ts
 */
import {
  createBlankProfile,
  deleteDeviceProfile,
  getActiveProfile,
  getActiveProfileId,
  getDeviceProfiles,
  initializeDeviceProfiles,
  resetDeviceProfilesForTest,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function run(): Promise<void> {
  console.log('\n=== device-profile basic api ===\n');
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetDeviceProfilesForTest();

  const seeded = { ...createBlankProfile('Seeded'), id: 'dev_seeded' };
  await adapter.set('laserforge_device_profiles', JSON.stringify([seeded]));
  await adapter.set('laserforge_active_profile', seeded.id);

  await initializeDeviceProfiles();

  assert(getDeviceProfiles().length === 1, 'initialize loads seeded profiles');
  assert(getActiveProfileId() === seeded.id, 'initialize loads seeded active profile id');
  assert(getActiveProfile()?.id === seeded.id, 'getActiveProfile resolves active profile');

  const updated = { ...seeded, name: 'Seeded Updated' };
  saveDeviceProfile(updated);
  assert(getDeviceProfiles()[0]?.name === 'Seeded Updated', 'saveDeviceProfile updates existing profile');

  const added = { ...createBlankProfile('Added'), id: 'dev_added' };
  saveDeviceProfile(added);
  assert(getDeviceProfiles().some(p => p.id === added.id), 'saveDeviceProfile appends new profile');

  setActiveProfileId(added.id);
  assert(getActiveProfileId() === added.id, 'setActiveProfileId updates active id');
  assert(getActiveProfile()?.id === added.id, 'getActiveProfile reflects new active id');

  deleteDeviceProfile(added.id);
  assert(!getDeviceProfiles().some(p => p.id === added.id), 'deleteDeviceProfile removes profile');

  setActiveProfileId(added.id);
  deleteDeviceProfile(added.id);
  assert(getActiveProfileId() == null, 'deleting active profile clears active id');

  setStorageForTest(null);
  resetDeviceProfilesForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetDeviceProfilesForTest();
  console.error(err);
  process.exit(1);
});
