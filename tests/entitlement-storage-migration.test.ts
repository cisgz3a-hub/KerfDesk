/**
 * EntitlementService localStorage -> Storage adapter migration tests.
 * Run: npx tsx tests/entitlement-storage-migration.test.ts
 */
import {
  EntitlementService,
} from '../src/entitlements/EntitlementService';
import {
  DEFAULT_TESTER_HMAC_SECRET,
  TESTER_KEY_MESSAGE_PREFIX,
} from '../src/entitlements/testerKey';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge_license';
const PRO_FLAG_KEY = 'laserforge_pro';
const LICENSE_CACHE_KEY = 'laserforge_license_cache';

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

async function makeTesterCode(slug: string): Promise<string> {
  const message = `${TESTER_KEY_MESSAGE_PREFIX}${slug.toUpperCase()}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(DEFAULT_TESTER_HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8)
    .toUpperCase();
  return `TF-${slug.toUpperCase()}-${hex}`;
}

async function run(): Promise<void> {
  console.log('\n=== entitlement storage migration ===\n');
  installMockLocalStorage();

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);

    const tester = await makeTesterCode('migrate');
    memoryStore[STORAGE_KEY] = tester;
    memoryStore[PRO_FLAG_KEY] = 'true';
    memoryStore[LICENSE_CACHE_KEY] = JSON.stringify({
      code: tester.toUpperCase().trim(),
      name: 'migrate@test',
      validatedAt: Date.now(),
      valid: true,
    });

    const svc = new EntitlementService();
    assert(svc.hasPro() === false, 'hasPro() stays sync and false before initialize');
    await svc.initialize();

    assert((await adapter.get(STORAGE_KEY)) === tester, 'migrates license key to adapter');
    assert(await adapter.get(PRO_FLAG_KEY) === 'true', 'migrates pro flag to adapter');
    assert((await adapter.get(LICENSE_CACHE_KEY)) != null, 'migrates license cache to adapter');
    assert(memoryStore[STORAGE_KEY] == null, 'clears legacy localStorage license key');
    assert(memoryStore[LICENSE_CACHE_KEY] == null, 'clears legacy localStorage cache');
    assert(svc.hasPro() === true, 'hasPro() reflects migrated valid tester entitlement');
  }

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);

    const localCode = await makeTesterCode('local');
    const storageCode = await makeTesterCode('storage');
    await adapter.set(STORAGE_KEY, storageCode);
    memoryStore[STORAGE_KEY] = localCode;

    const svc = new EntitlementService();
    await svc.initialize();

    assert((await adapter.get(STORAGE_KEY)) === storageCode, 'storage value wins when both exist');
    assert(memoryStore[STORAGE_KEY] === localCode, 'legacy localStorage value preserved when storage already set');
    assert(svc.getState().code === storageCode, 'service loads entitlement from storage value');
  }

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);

    const svc = new EntitlementService();
    await svc.initialize();

    assert((await adapter.list()).length === 0, 'empty localStorage migration is a no-op');
    assert(svc.hasPro() === false, 'empty storage starts as free tier');
  }

  setStorageForTest(null);
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  console.error(err);
  process.exit(1);
});
