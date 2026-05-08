/**
 * T2-120 regression tests: Electron storage IPC is typed by namespace.
 * Run: npx tsx tests/typed-storage-ipc.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilesystemStorageAdapter, type StorageIpc } from '../src/core/storage/FilesystemStorageAdapter';
import { routeStorageKey } from '../src/core/storage/StorageNamespaces';

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

function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function makeRecordingIpc(calls: string[]): StorageIpc {
  const makeScope = (name: string) => ({
    get: async (key: string) => {
      calls.push(`${name}.get:${key}`);
      return null;
    },
    set: async (key: string, value: string) => {
      calls.push(`${name}.set:${key}:${value}`);
    },
    remove: async (key: string) => {
      calls.push(`${name}.remove:${key}`);
    },
    list: async () => {
      calls.push(`${name}.list`);
      return [
        `${name}:key`,
        name === 'replays' ? 'laserforge_replay_allowed' : `${name}:other`,
      ];
    },
  });
  return {
    storage: {
      deviceProfiles: makeScope('deviceProfiles'),
      materials: makeScope('materials'),
      autosave: makeScope('autosave'),
      jobLogs: makeScope('jobLogs'),
      replays: makeScope('replays'),
      entitlements: makeScope('entitlements'),
      diagnostics: makeScope('diagnostics'),
      settings: makeScope('settings'),
    },
  };
}

void (async () => {
  console.log('\n=== typed storage IPC (T2-120) ===\n');

  {
    assert(routeStorageKey('laserforge_device_profiles') === 'deviceProfiles', 'device profile key routes to deviceProfiles');
    assert(routeStorageKey('laserforge_active_profile') === 'deviceProfiles', 'active profile key routes to deviceProfiles');
    assert(routeStorageKey('laserforge_user_materials') === 'materials', 'material preset key routes to materials');
    assert(routeStorageKey('laserforge_autosave_record') === 'autosave', 'autosave record routes to autosave');
    assert(routeStorageKey('laserforge_job_logs') === 'jobLogs', 'job log key routes to jobLogs');
    assert(routeStorageKey('laserforge_replay_abc') === 'replays', 'replay key routes to replays');
    assert(routeStorageKey('laserforge_license_cache') === 'entitlements', 'license cache key routes to entitlements');
    assert(routeStorageKey('laserforge_user_mode') === 'settings', 'settings key routes to settings');

    let threw = false;
    try {
      routeStorageKey('unscoped_user_supplied_key');
    } catch {
      threw = true;
    }
    assert(threw, 'unknown keys are rejected instead of falling through to broad storage');
  }

  {
    const calls: string[] = [];
    const adapter = new FilesystemStorageAdapter(makeRecordingIpc(calls));
    await adapter.set('laserforge_device_profiles', 'profiles-json');
    await adapter.get('laserforge_license_cache');
    await adapter.remove('laserforge_autosave_record');
    const listed = await adapter.list('laserforge_replay_');

    assert(calls.includes('deviceProfiles.set:laserforge_device_profiles:profiles-json'), 'adapter writes profiles through profile namespace');
    assert(calls.includes('entitlements.get:laserforge_license_cache'), 'adapter reads license cache through entitlement namespace');
    assert(calls.includes('autosave.remove:laserforge_autosave_record'), 'adapter removes autosave through autosave namespace');
    assert(calls.includes('replays.list'), 'adapter lists replay prefix through replay namespace');
    assert(
      listed.length === 1 && listed[0] === 'laserforge_replay_allowed',
      'adapter preserves list(prefix) filtering after namespaced list',
    );
  }

  {
    const preload = codeOnly(join(REPO_ROOT, 'electron', 'preload.ts'));
    assert(!/storageGet\s*:/.test(preload), 'preload.ts no longer exposes broad storageGet');
    assert(!/storageSet\s*:/.test(preload), 'preload.ts no longer exposes broad storageSet');
    assert(!/storageRemove\s*:/.test(preload), 'preload.ts no longer exposes broad storageRemove');
    assert(!/storageList\s*:/.test(preload), 'preload.ts no longer exposes broad storageList');
    assert(/storage\s*:/.test(preload), 'preload.ts exposes a typed storage namespace object');
  }

  {
    const main = codeOnly(join(REPO_ROOT, 'electron', 'main.ts'));
    assert(!/ipcMain\.handle\(\s*['"]storage:get['"]/.test(main), 'main.ts no longer registers broad storage:get');
    assert(!/ipcMain\.handle\(\s*['"]storage:set['"]/.test(main), 'main.ts no longer registers broad storage:set');
    assert(!/ipcMain\.handle\(\s*['"]storage:remove['"]/.test(main), 'main.ts no longer registers broad storage:remove');
    assert(!/ipcMain\.handle\(\s*['"]storage:list['"]/.test(main), 'main.ts no longer registers broad storage:list');
    assert(/registerStorageNamespace/.test(main) && /\$\{channelPrefix\}:get/.test(main), 'main.ts registers typed namespace storage IPC');
    assert(/isStorageKeyAllowed/.test(main), 'main.ts validates keys against the namespace allow-list');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
