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

    assert(
      backend.namespacedGet('deviceProfiles', 'laserforge_device_profiles') === null,
      'get(missing) returns null',
    );

    backend.namespacedSet('deviceProfiles', 'laserforge_device_profiles', 'v');
    assert(
      backend.namespacedGet('deviceProfiles', 'laserforge_device_profiles') === 'v',
      'set/get round trip',
    );

    backend.namespacedSet('deviceProfiles', 'laserforge_device_profiles', 'a');
    backend.namespacedSet('deviceProfiles', 'laserforge_device_profiles', 'b');
    assert(
      backend.namespacedGet('deviceProfiles', 'laserforge_device_profiles') === 'b',
      'set overwrites value',
    );

    backend.namespacedRemove('deviceProfiles', 'laserforge_device_profiles');
    assert(
      backend.namespacedGet('deviceProfiles', 'laserforge_device_profiles') === null,
      'remove deletes key',
    );

    let removeMissingThrew = false;
    try {
      backend.namespacedRemove('deviceProfiles', 'laserforge_device_profile_missing');
    } catch {
      removeMissingThrew = true;
    }
    assert(!removeMissingThrew, 'remove(missing) does not throw');

    backend.namespacedSet('deviceProfiles', 'laserforge_device_profile_1', 'x');
    backend.namespacedSet('deviceProfiles', 'laserforge_device_profile_2', 'y');
    backend.namespacedSet('materials', 'laserforge_material_1', 'z');
    const listed = backend.namespacedList('deviceProfiles');
    assert(
      listed.includes('laserforge_device_profile_1')
      && listed.includes('laserforge_device_profile_2')
      && !listed.includes('laserforge_material_1'),
      'list returns namespace keys',
    );
    const pref = backend.namespacedList('deviceProfiles', 'laserforge_device_profile_');
    assert(
      pref.length === 2 && pref.every(k => k.startsWith('laserforge_device_profile_')),
      'list(prefix) filters keys',
    );

    const unicodeKey = 'laserforge_settings_unicode';
    const unicodeValue = 'hello 你好 🚀';
    backend.namespacedSet('settings', unicodeKey, unicodeValue);
    assert(
      backend.namespacedGet('settings', unicodeKey) === unicodeValue,
      'unicode key/value round-trip',
    );

    const large = 'L'.repeat(1024 * 1024);
    backend.namespacedSet('autosave', 'laserforge_autosave_record', large);
    assert(
      (backend.namespacedGet('autosave', 'laserforge_autosave_record') ?? '').length === large.length,
      '1MB value round-trips',
    );

    backend.storageClear();
    assert(backend.namespacedList('autosave').length === 0, 'clear removes all entries');
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
