/**
 * JobLog localStorage -> Storage adapter migration tests.
 * Run: npx tsx tests/joblog-storage-migration.test.ts
 */
import { getJobLogs, resetJobLogsForTest } from '../src/core/job/JobLog';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge_job_logs';

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
  console.log('\n=== joblog storage migration ===\n');
  installMockLocalStorage();

  {
    clearLegacyStore();
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetJobLogsForTest();

    const legacyLogs = [{ id: 'legacy-a', entries: [] }];
    memoryStore[STORAGE_KEY] = JSON.stringify(legacyLogs);

    const loaded = await getJobLogs();
    assert(loaded.length === 1 && loaded[0]?.id === 'legacy-a', 'migrates legacy logs into storage');
    assert(memoryStore[STORAGE_KEY] == null, 'clears legacy logs after migration');

    const fromAdapterRaw = await adapter.get(STORAGE_KEY);
    const fromAdapter = JSON.parse(fromAdapterRaw ?? '[]') as Array<{ id?: string }>;
    assert(fromAdapter.length === 1 && fromAdapter[0]?.id === 'legacy-a', 'adapter receives migrated logs');
  }

  {
    clearLegacyStore();
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetJobLogsForTest();

    await adapter.set(STORAGE_KEY, JSON.stringify([{ id: 'storage-a', entries: [] }]));
    memoryStore[STORAGE_KEY] = JSON.stringify([{ id: 'legacy-b', entries: [] }]);

    const loaded = await getJobLogs();
    assert(loaded.length === 1 && loaded[0]?.id === 'storage-a', 'adapter values win when both stores have data');
    assert(memoryStore[STORAGE_KEY] != null, 'legacy logs left untouched when adapter already populated');
  }

  {
    clearLegacyStore();
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetJobLogsForTest();

    const loaded = await getJobLogs();
    assert(loaded.length === 0, 'empty legacy storage no-op');
  }

  setStorageForTest(null);
  resetJobLogsForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetJobLogsForTest();
  console.error(err);
  process.exit(1);
});
