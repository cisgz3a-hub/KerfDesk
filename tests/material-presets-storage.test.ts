/**
 * MaterialPresets (user starter materials) storage tests.
 * Run: npx tsx tests/material-presets-storage.test.ts
 */
import {
  deleteUserMaterial,
  getAllMaterials,
  getUserMaterials,
  initializeMaterialPresets,
  MATERIAL_PRESETS,
  resetMaterialPresetsForTest,
  saveUserMaterial,
  type UserStarterMaterial,
} from '../src/core/materials/MaterialPresets';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

const USER_MATERIALS_KEY = 'laserforge_user_materials';

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

function makeUserMat(id: string): UserStarterMaterial {
  const base = MATERIAL_PRESETS[0]!;
  return {
    ...base,
    id,
    isUser: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function run(): Promise<void> {
  console.log('\n=== material presets storage ===\n');
  installMockLocalStorage();

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetMaterialPresetsForTest();

    const legacy = [makeUserMat('user-legacy-1')];
    memoryStore[USER_MATERIALS_KEY] = JSON.stringify(legacy);

    await initializeMaterialPresets();
    assert(memoryStore[USER_MATERIALS_KEY] == null, 'migration clears legacy localStorage');
    const raw = await adapter.get(USER_MATERIALS_KEY);
    assert(raw != null && raw.includes('user-legacy-1'), 'adapter holds migrated user materials');

    const user = getUserMaterials();
    assert(user.length === 1 && user[0]!.id === 'user-legacy-1', 'getUserMaterials reads cache');
  }

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetMaterialPresetsForTest();
    await initializeMaterialPresets();

    saveUserMaterial(makeUserMat('user-new-1'));
    await Promise.resolve();
    const persisted = await adapter.get(USER_MATERIALS_KEY);
    assert(persisted != null && persisted.includes('user-new-1'), 'saveUserMaterial persists');

    const all = getAllMaterials();
    assert(all.length === MATERIAL_PRESETS.length + 1, 'getAllMaterials merges defaults + user');

    deleteUserMaterial('user-new-1');
    await Promise.resolve();
    const after = getUserMaterials();
    assert(after.every(m => m.id !== 'user-new-1'), 'deleteUserMaterial removes from cache');
  }

  setStorageForTest(null);
  resetMaterialPresetsForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetMaterialPresetsForTest();
  console.error(err);
  process.exit(1);
});
