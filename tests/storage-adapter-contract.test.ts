/**
 * Storage adapter contract tests.
 * Run: npx tsx tests/storage-adapter-contract.test.ts
 */
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { IndexedDbStorageAdapter } from '../src/core/storage/IndexedDbStorageAdapter';
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

async function runContract(
  name: string,
  makeAdapter: () => StorageAdapter,
): Promise<void> {
  console.log(`\n=== storage contract: ${name} ===`);
  const adapter = makeAdapter();
  await adapter.clear();

  assert(await adapter.get('missing') === null, 'get(missing) returns null');

  await adapter.set('k', 'v');
  assert(await adapter.get('k') === 'v', 'set/get round trip');

  await adapter.set('k', 'a');
  await adapter.set('k', 'b');
  assert(await adapter.get('k') === 'b', 'set overwrites existing value');

  await adapter.remove('k');
  assert(await adapter.get('k') === null, 'remove deletes key');

  let removeMissingThrew = false;
  try {
    await adapter.remove('missing-remove');
  } catch {
    removeMissingThrew = true;
  }
  assert(!removeMissingThrew, 'remove(missing) does not throw');

  await adapter.set('alpha:1', 'x');
  await adapter.set('alpha:2', 'y');
  await adapter.set('beta:1', 'z');
  const allKeys = await adapter.list();
  assert(
    allKeys.includes('alpha:1') && allKeys.includes('alpha:2') && allKeys.includes('beta:1'),
    'list() returns all keys',
  );
  const alphaKeys = await adapter.list('alpha:');
  assert(
    alphaKeys.length === 2 && alphaKeys.every(k => k.startsWith('alpha:')),
    'list(prefix) filters keys by prefix',
  );

  const large = 'L'.repeat(1024 * 1024);
  await adapter.set('large', large);
  assert((await adapter.get('large'))?.length === large.length, '1MB value round-trips intact');

  const unicodeKey = '鍵🔑:emoji';
  const unicodeValue = '你好, мир, hello, 🚀';
  await adapter.set(unicodeKey, unicodeValue);
  assert(await adapter.get(unicodeKey) === unicodeValue, 'unicode key/value round-trip');

  const jobs: Promise<void>[] = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(adapter.set(`concurrent:${i}`, `v${i}`));
  }
  await Promise.all(jobs);
  const concurrentKeys = await adapter.list('concurrent:');
  assert(concurrentKeys.length === 10, '10 concurrent writes all persisted');

  await adapter.clear();
  assert((await adapter.list()).length === 0, 'clear() removes all keys');
}

async function maybeRunIndexedDbContract(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    console.log('\n=== storage contract: indexeddb ===');
    console.log('  - skipped (indexedDB not available in this runtime)');
    return;
  }
  try {
    indexedDB.deleteDatabase('laserforge_storage');
  } catch {
    // ignore best-effort cleanup
  }
  await runContract('indexeddb', () => new IndexedDbStorageAdapter());
}

async function run(): Promise<void> {
  console.log('\n=== storage adapter contract ===\n');
  await runContract('in-memory', () => new InMemoryStorageAdapter());
  await maybeRunIndexedDbContract();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
