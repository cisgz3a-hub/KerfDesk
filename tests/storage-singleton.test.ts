/**
 * Storage singleton tests.
 * Run: npx tsx tests/storage-singleton.test.ts
 */
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { getStorage, setStorageForTest } from '../src/core/storage/storage';
import type { StorageAdapter } from '../src/core/storage/StorageAdapter';

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
  console.log('\n=== storage singleton ===\n');

  const original = getStorage();
  assert(typeof original.get === 'function', 'default getStorage() returns StorageAdapter');
  assert(typeof original.set === 'function', 'default adapter has set()');
  assert(typeof original.list === 'function', 'default adapter has list()');

  const override = new InMemoryStorageAdapter();
  setStorageForTest(override);
  assert(getStorage() === override, 'setStorageForTest(adapter) is returned by getStorage()');

  const concurrent = await Promise.all([
    Promise.resolve().then(() => getStorage()),
    Promise.resolve().then(() => getStorage()),
    Promise.resolve().then(() => getStorage()),
    Promise.resolve().then(() => getStorage()),
    Promise.resolve().then(() => getStorage()),
  ]);
  assert(concurrent.every(s => s === override), 'concurrent getStorage() calls see same override');

  await getStorage().set('singleton:key', 'value');
  assert(await getStorage().get('singleton:key') === 'value', 'overridden adapter functions normally');

  setStorageForTest(null);
  const restored = getStorage();
  assert(restored === original, 'setStorageForTest(null) restores default singleton');

  const afterClear = getStorage();
  assert(afterClear !== override, 'default is no longer the test override');

  setStorageForTest(null);

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  console.error(err);
  process.exit(1);
});
