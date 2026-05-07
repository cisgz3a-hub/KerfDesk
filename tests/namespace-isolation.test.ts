/**
 * T2-128 regression tests: filesystem storage is namespace-aware below IPC.
 * Run: npx tsx tests/namespace-isolation.test.ts
 */
export {};

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStorageFsBackend } from '../electron/storage';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

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

void (async () => {
  console.log('\n=== namespace storage isolation (T2-128) ===\n');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-storage-ns-test-'));
  try {
    const backend = createStorageFsBackend(tempRoot);

    backend.namespacedSet('deviceProfiles', 'laserforge_device_profiles', 'profiles');
    backend.namespacedSet('entitlements', 'laserforge_license_cache', 'license');

    assert(
      backend.namespacedGet('deviceProfiles', 'laserforge_device_profiles') === 'profiles',
      'deviceProfiles namespace reads its own key',
    );
    assert(
      backend.namespacedGet('entitlements', 'laserforge_license_cache') === 'license',
      'entitlements namespace reads its own key',
    );

    let wrongWrite: Error | null = null;
    try {
      backend.namespacedSet('deviceProfiles', 'laserforge_license_cache', 'poison');
    } catch (err) {
      wrongWrite = err as Error;
    }
    assert(wrongWrite !== null, 'deviceProfiles namespace cannot write license key');
    assert(/deviceProfiles/.test(wrongWrite?.message ?? ''), 'wrong-namespace error names attempted namespace');
    assert(
      backend.namespacedGet('entitlements', 'laserforge_license_cache') === 'license',
      'failed cross-namespace write leaves license value unchanged',
    );

    let wrongRead: Error | null = null;
    try {
      backend.namespacedGet('materials', 'laserforge_license_cache');
    } catch (err) {
      wrongRead = err as Error;
    }
    assert(wrongRead !== null, 'wrong namespace cannot read license key');

    backend.namespacedSet('deviceProfiles', 'laserforge_device_profile_custom', 'one-profile');
    const profileKeys = backend.namespacedList('deviceProfiles');
    assert(
      profileKeys.includes('laserforge_device_profiles')
      && profileKeys.includes('laserforge_device_profile_custom')
      && !profileKeys.includes('laserforge_license_cache'),
      'namespacedList returns only keys allowed for that namespace',
    );
    const filteredProfiles = backend.namespacedList('deviceProfiles', 'laserforge_device_profile_custom');
    assert(
      filteredProfiles.length === 1 && filteredProfiles[0] === 'laserforge_device_profile_custom',
      'namespacedList(prefix) still filters inside the namespace',
    );

    backend.namespacedRemove('deviceProfiles', 'laserforge_device_profile_custom');
    assert(
      backend.namespacedGet('deviceProfiles', 'laserforge_device_profile_custom') === null,
      'namespacedRemove removes allowed key',
    );
  } finally {
    rmrf(tempRoot);
  }

  {
    const storageSource = readFileSync(join(REPO_ROOT, 'electron', 'storage.ts'), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert(!/export function storageGet\s*\(/.test(storageSource), 'storage.ts no longer exports generic storageGet');
    assert(!/export function storageSet\s*\(/.test(storageSource), 'storage.ts no longer exports generic storageSet');
    assert(!/export function storageRemove\s*\(/.test(storageSource), 'storage.ts no longer exports generic storageRemove');
    assert(!/export function storageList\s*\(/.test(storageSource), 'storage.ts no longer exports generic storageList');
    assert(/namespacedStorageSet/.test(storageSource), 'storage.ts exports namespaced storage functions');
  }

  {
    const mainSource = readFileSync(join(REPO_ROOT, 'electron', 'main.ts'), 'utf8');
    assert(/namespacedStorageSet/.test(mainSource), 'main.ts uses namespaced storage set');
    assert(!/import \{ storageGet, storageSet, storageRemove, storageList \}/.test(mainSource), 'main.ts no longer imports generic storage helpers');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
