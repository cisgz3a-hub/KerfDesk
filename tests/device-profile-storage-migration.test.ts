/**
 * DeviceProfile localStorage -> Storage adapter migration tests.
 * Run: npx tsx tests/device-profile-storage-migration.test.ts
 */
import {
  createBlankProfile,
  getActiveProfileId,
  getDeviceProfiles,
  initializeDeviceProfiles,
  resetDeviceProfilesForTest,
} from '../src/core/devices/DeviceProfile';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge_device_profiles';
const ACTIVE_PROFILE_KEY = 'laserforge_active_profile';

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

function clearLegacyStore(): void {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
}

async function run(): Promise<void> {
  console.log('\n=== device-profile storage migration ===\n');
  installMockLocalStorage();

  {
    clearLegacyStore();
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetDeviceProfilesForTest();

    const legacyProfile = { ...createBlankProfile('Legacy'), id: 'legacy-a' };
    memoryStore[STORAGE_KEY] = JSON.stringify([legacyProfile]);
    memoryStore[ACTIVE_PROFILE_KEY] = legacyProfile.id;

    await initializeDeviceProfiles();
    const loaded = getDeviceProfiles();
    assert(loaded.length === 1 && loaded[0].id === legacyProfile.id, 'migrates legacy profiles into storage');
    assert(getActiveProfileId() === legacyProfile.id, 'migrates legacy active profile id');
    assert(memoryStore[STORAGE_KEY] == null, 'clears legacy profile list after migration');
    assert(memoryStore[ACTIVE_PROFILE_KEY] == null, 'clears legacy active id after migration');
  }

  {
    clearLegacyStore();
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetDeviceProfilesForTest();

    const storageProfile = { ...createBlankProfile('Storage'), id: 'storage-a' };
    await adapter.set(STORAGE_KEY, JSON.stringify([storageProfile]));
    await adapter.set(ACTIVE_PROFILE_KEY, storageProfile.id);

    const legacyProfile = { ...createBlankProfile('Legacy'), id: 'legacy-b' };
    memoryStore[STORAGE_KEY] = JSON.stringify([legacyProfile]);
    memoryStore[ACTIVE_PROFILE_KEY] = legacyProfile.id;

    await initializeDeviceProfiles();
    const loaded = getDeviceProfiles();
    assert(loaded.length === 1 && loaded[0].id === storageProfile.id, 'adapter values win when both stores have data');
    assert(getActiveProfileId() === storageProfile.id, 'active profile id comes from adapter value');
    assert(memoryStore[STORAGE_KEY] != null, 'legacy profile list left untouched when adapter already populated');
    assert(memoryStore[ACTIVE_PROFILE_KEY] != null, 'legacy active id left untouched when adapter already populated');
  }

  {
    clearLegacyStore();
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetDeviceProfilesForTest();

    await initializeDeviceProfiles();
    assert(getDeviceProfiles().length === 0, 'empty legacy storage no-op for profiles');
    assert(getActiveProfileId() == null, 'empty legacy storage no-op for active profile');
  }

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
