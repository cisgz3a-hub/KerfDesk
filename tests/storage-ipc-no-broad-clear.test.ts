/**
 * T1-84 regression test: the broad `storage:clear` IPC must not be exposed
 * to renderer code, and the FilesystemStorageAdapter must reject any caller
 * who tries to invoke `clear()`.
 *
 * Bug: electron/main.ts exposed `ipcMain.handle('storage:clear', ...)` which
 * wiped every .json file in the storage directory in one call — license,
 * device profiles, material presets, autosave, all job logs. Any renderer
 * code path could trigger this via `window.electronAPI.storageClear()`.
 * Even without an attacker, a developer console copy-paste, a misbehaving
 * extension that gains renderer access, or a future code path that called
 * clear inappropriately could wipe a paid customer's entire app state.
 *
 * Fix: remove the broad IPC entirely.
 *  - electron/main.ts no longer registers `ipcMain.handle('storage:clear')`.
 *  - electron/preload.ts no longer exposes `storageClear` on electronAPI.
 *  - StorageIpc interface drops storageClear; bootstrap guard no longer
 *    requires it.
 *  - FilesystemStorageAdapter.clear() rejects with a descriptive error so
 *    a future caller hitting Electron storage sees an immediate failure
 *    pointing at the right pattern.
 *
 * The main-process `storageClear()` function in electron/storage.ts stays
 * (used by tests/storage-filesystem-unit.test.ts). What's removed is the
 * IPC surface — the renderer can no longer trigger bulk clear.
 *
 * Other adapters (InMemory, IndexedDB) keep `clear()` because tests need
 * it. Only the filesystem adapter rejects.
 *
 * Run: npx tsx tests/storage-ipc-no-broad-clear.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilesystemStorageAdapter, type StorageIpc } from '../src/core/storage/FilesystemStorageAdapter';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';

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

void (async () => {
  console.log('\n=== storage:clear IPC removed (T1-84) ===\n');

  // ── 1. electron/preload.ts does NOT expose storageClear ───────────────
  {
    const text = readFileSync(join(REPO_ROOT, 'electron', 'preload.ts'), 'utf8');
    // The line `storageClear: () => ipcRenderer.invoke('storage:clear') ...`
    // must NOT exist. Comments mentioning T1-84 are fine.
    const codeOnly = text
      .replace(/\/\/[^\n]*/g, '')   // strip line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // strip block comments
    assert(
      !/storageClear\s*:/i.test(codeOnly),
      'preload.ts does not expose storageClear: on electronAPI',
    );
    assert(
      !/['"]storage:clear['"]/.test(codeOnly),
      'preload.ts does not reference the "storage:clear" channel name in code',
    );
  }

  // ── 2. electron/main.ts does NOT register the storage:clear handler ──
  {
    const text = readFileSync(join(REPO_ROOT, 'electron', 'main.ts'), 'utf8');
    const codeOnly = text
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // ipcMain.handle('storage:clear', ...) must not appear.
    assert(
      !/ipcMain\.handle\(\s*['"]storage:clear['"]/.test(codeOnly),
      'main.ts does not register ipcMain.handle("storage:clear")',
    );
    // The storageClear import was dropped — the bare identifier shouldn't
    // appear in code (only in T1-84 explanatory comments).
    assert(
      !/\bstorageClear\b/.test(codeOnly),
      'main.ts does not import or reference the storageClear function',
    );
  }

  // ── 3. FilesystemStorageAdapter.clear() rejects with the T1-84 message ──
  {
    // Build a stub IPC that satisfies the (now-narrower) StorageIpc
    // interface. The adapter's clear() doesn't consult the IPC at all
    // anymore — it rejects immediately — so the stubs below are minimal.
    const stub: StorageIpc = {
      storageGet: () => Promise.resolve(null),
      storageSet: () => Promise.resolve(),
      storageRemove: () => Promise.resolve(),
      storageList: () => Promise.resolve([]),
    };
    const adapter = new FilesystemStorageAdapter(stub);
    let caught: Error | null = null;
    try {
      await adapter.clear();
    } catch (err) {
      caught = err as Error;
    }
    assert(caught !== null, 'FilesystemStorageAdapter.clear() rejects (does not silently succeed)');
    assert(
      /T1-84/.test(caught?.message ?? ''),
      'rejection message references T1-84 so the cause is discoverable',
    );
    assert(
      /scoped|targeted|remove\(\)/i.test(caught?.message ?? ''),
      'rejection message points at the right pattern (targeted remove or scoped IPC)',
    );
  }

  // ── 4. InMemoryStorageAdapter.clear() still works (tests need it) ────
  {
    const inMem = new InMemoryStorageAdapter();
    await inMem.set('k1', 'v1');
    await inMem.set('k2', 'v2');
    assert((await inMem.list()).length === 2, 'in-memory has 2 entries before clear');
    await inMem.clear();
    assert(
      (await inMem.list()).length === 0,
      'InMemoryStorageAdapter.clear() unaffected by T1-84 (tests still need it)',
    );
  }

  // ── 5. bootstrap.isStorageIpc accepts a shape WITHOUT storageClear ───
  // We don't import isStorageIpc directly (it isn't exported) — so we
  // verify by reading the source and checking that storageClear is no
  // longer one of the required keys. Indirect but reliable.
  {
    const text = readFileSync(
      join(REPO_ROOT, 'src', 'core', 'storage', 'bootstrap.ts'),
      'utf8',
    );
    const codeOnly = text
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // The function-typed key check `typeof typed.storageClear === 'function'`
    // must not appear in code (only in comments).
    assert(
      !/typed\.storageClear/.test(codeOnly),
      'bootstrap.ts isStorageIpc no longer requires storageClear',
    );
    // But the four other keys must still be required:
    assert(
      /typed\.storageGet/.test(codeOnly),
      'bootstrap.ts isStorageIpc still requires storageGet',
    );
    assert(
      /typed\.storageSet/.test(codeOnly),
      'bootstrap.ts isStorageIpc still requires storageSet',
    );
    assert(
      /typed\.storageRemove/.test(codeOnly),
      'bootstrap.ts isStorageIpc still requires storageRemove',
    );
    assert(
      /typed\.storageList/.test(codeOnly),
      'bootstrap.ts isStorageIpc still requires storageList',
    );
  }

  // ── 6. StorageIpc interface in FilesystemStorageAdapter dropped storageClear ──
  {
    const text = readFileSync(
      join(REPO_ROOT, 'src', 'core', 'storage', 'FilesystemStorageAdapter.ts'),
      'utf8',
    );
    // The interface body lines: locate the StorageIpc declaration block.
    const ifaceMatch = text.match(/export interface StorageIpc \{([\s\S]*?)\n\}/);
    assert(ifaceMatch !== null, 'StorageIpc interface is present');
    const body = ifaceMatch?.[1] ?? '';
    // Drop comments to scrutinize members only.
    const codeOnly = body
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert(
      !/storageClear\s*\(/.test(codeOnly),
      'StorageIpc interface no longer declares a storageClear method',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
