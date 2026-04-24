/**
 * Filesystem storage backend unit tests (no Electron runtime).
 * Run: npx tsx tests/storage-filesystem-unit.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createStorageFsBackend } from '../electron/storage';

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

function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

async function run(): Promise<void> {
  console.log('\n=== storage filesystem backend ===\n');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-storage-test-'));
  try {
    const backend = createStorageFsBackend(tempRoot);

    assert(backend.storageGet('missing') === null, 'get(missing) returns null');

    backend.storageSet('k', 'v');
    assert(backend.storageGet('k') === 'v', 'set/get round trip');

    backend.storageSet('k', 'a');
    backend.storageSet('k', 'b');
    assert(backend.storageGet('k') === 'b', 'set overwrites value');

    backend.storageRemove('k');
    assert(backend.storageGet('k') === null, 'remove deletes key');

    let removeMissingThrew = false;
    try {
      backend.storageRemove('missing-remove');
    } catch {
      removeMissingThrew = true;
    }
    assert(!removeMissingThrew, 'remove(missing) does not throw');

    backend.storageSet('pref:1', 'x');
    backend.storageSet('pref:2', 'y');
    backend.storageSet('other:1', 'z');
    const listed = backend.storageList();
    assert(
      listed.includes('pref:1') && listed.includes('pref:2') && listed.includes('other:1'),
      'list returns all keys',
    );
    const pref = backend.storageList('pref:');
    assert(pref.length === 2 && pref.every(k => k.startsWith('pref:')), 'list(prefix) filters keys');

    const unicodeKey = '鍵🔑:emoji';
    const unicodeValue = 'hello 你好 🚀';
    backend.storageSet(unicodeKey, unicodeValue);
    assert(backend.storageGet(unicodeKey) === unicodeValue, 'unicode key/value round-trip');

    const large = 'L'.repeat(1024 * 1024);
    backend.storageSet('large', large);
    assert((backend.storageGet('large') ?? '').length === large.length, '1MB value round-trips');

    backend.storageClear();
    assert(backend.storageList().length === 0, 'clear removes all entries');
  } finally {
    rmrf(tempRoot);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
