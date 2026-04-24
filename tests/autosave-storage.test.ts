/**
 * Autosave persistence via Storage adapter.
 * Run: npx tsx tests/autosave-storage.test.ts
 */
import {
  clearAutosave,
  readAutosave,
  resetAutosaveForTest,
  writeAutosave,
} from '../src/app/autosavePersistence';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

const AUTOSAVE_KEY = 'laserforge_autosave';
const AUTOSAVE_TIME_KEY = 'laserforge_autosave_time';

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

async function run(): Promise<void> {
  console.log('\n=== autosave storage ===\n');
  installMockLocalStorage();

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetAutosaveForTest();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];

    const json = '{"format":"laserforge","version":"1.0","scene":{"objects":[1]}}';
    writeAutosave(json);
    await new Promise<void>(r => {
      setTimeout(r, 0);
    });
    const payload = await readAutosave();
    assert(payload?.json === json, 'writeAutosave + readAutosave round-trip json');
    assert(payload?.timestamp != null && payload.timestamp.length > 10, 'timestamp present');
  }

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetAutosaveForTest();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const empty = await readAutosave();
    assert(empty === null, 'readAutosave null when empty');
  }

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetAutosaveForTest();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    writeAutosave('{"keep":1}');
    await new Promise<void>(r => {
      setTimeout(r, 0);
    });
    clearAutosave();
    await new Promise<void>(r => {
      setTimeout(r, 0);
    });
    assert(await adapter.get(AUTOSAVE_KEY) === null, 'clearAutosave removes json key');
    assert(await adapter.get(AUTOSAVE_TIME_KEY) === null, 'clearAutosave removes time key');
  }

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetAutosaveForTest();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    memoryStore[AUTOSAVE_KEY] = '{"migrated":true}';
    memoryStore[AUTOSAVE_TIME_KEY] = '2026-01-01T00:00:00.000Z';

    const payload = await readAutosave();
    assert(payload?.json.includes('migrated'), 'legacy localStorage json migrated');
    assert(memoryStore[AUTOSAVE_KEY] == null, 'legacy autosave key cleared from localStorage');
    const fromAdapter = await adapter.get(AUTOSAVE_KEY);
    assert(fromAdapter != null && fromAdapter.includes('migrated'), 'adapter holds migrated autosave');
  }

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetAutosaveForTest();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const size = 6 * 1024 * 1024;
    const big = `{"pad":"${'a'.repeat(size)}"}`;
    writeAutosave(big);
    await new Promise<void>(r => {
      setTimeout(r, 0);
    });
    const payload = await readAutosave();
    assert(payload?.json.length === big.length, 'large payload (~6MB) round-trips intact');
  }

  setStorageForTest(null);
  resetAutosaveForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetAutosaveForTest();
  console.error(err);
  process.exit(1);
});
