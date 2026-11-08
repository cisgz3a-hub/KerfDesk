import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { useStore } from '../state';
import { writeAutosave } from '../state/autosave';
import { AutosaveDurableService } from '../state/autosave-durable';
import { IndexedDbAutosaveRepository } from '../state/autosave-indexeddb';
import { AutosaveSessionLocks } from '../state/autosave-session-lock';
import { restoreAutosaveSnapshot } from './use-autosave';

// V7-P1-1 (ADR-688 Amendment 1): a tab that closes with unsaved work leaves its
// 30 s IndexedDB copy and a newer unload copy in localStorage under one key.
// File > Recover unsaved work listed both, and restoring the older one deleted
// the newer one. Every tab shares one Web Locks manager, as in a browser: with
// no locks a foreign clear is retained and the loss never shows.
describe('recovering a session closed with unsaved work', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('lists the session once, with its newest copy', async () => {
    const browser = testBrowser();
    await closeTabWithUnsavedWork(browser);

    const next = browser.openTab();
    expect((await next.readLatest()).snapshot?.project.notes).toBe('unload copy');
    const recent = await next.readRecent();
    expect(recent.map((snapshot) => snapshot.project.notes)).toEqual(['unload copy']);
    await next.stop();
  });

  it('restores the newest copy and leaves no older copy behind', async () => {
    const browser = testBrowser();
    await closeTabWithUnsavedWork(browser);

    const next = browser.openTab();
    const [row] = await next.readRecent();
    expect(row).toBeDefined();
    expect(await restoreAutosaveSnapshot(row!, next)).toBe(true);
    expect(useStore.getState().project.notes).toBe('unload copy');
    await next.stop();

    // Only the re-homed copy remains; the closed session's interval copy is gone.
    const later = browser.openTab();
    const remaining = await later.readRecent();
    expect(remaining.map((snapshot) => snapshot.project.notes)).toEqual(['unload copy']);
    expect(remaining[0]?.storageKey).not.toBe(row!.storageKey);
    await later.stop();
  });

  it('never clears a newer copy when an older copy of the same session is restored', async () => {
    const browser = testBrowser();
    await closeTabWithUnsavedWork(browser);

    const next = browser.openTab();
    const newest = (await next.readRecent())[0]!;
    // An older row, as the list showed before this amendment.
    const older = { ...newest, project: project('interval copy'), savedAt: 1_000 };
    expect(await restoreAutosaveSnapshot(older, next)).toBe(true);
    expect(useStore.getState().project.notes).toBe('interval copy');
    await next.stop();

    const later = browser.openTab();
    const remaining = await later.readRecent();
    expect(remaining.map((snapshot) => snapshot.project.notes)).toEqual([
      'interval copy',
      'unload copy',
    ]);
    await later.stop();
  });

  it('discards both copies when the session is discarded', async () => {
    const browser = testBrowser();
    await closeTabWithUnsavedWork(browser);

    const next = browser.openTab();
    const read = await next.readLatest();
    expect(await next.clearRecovered(read.snapshot!)).toEqual({ kind: 'ok' });
    expect(await next.readRecent()).toEqual([]);
    await next.stop();
  });
});

async function closeTabWithUnsavedWork(browser: TestBrowser): Promise<void> {
  const tab = browser.openTab();
  expect(await tab.write(project('interval copy'), 1_000)).toMatchObject({
    kind: 'ok',
    backend: 'indexeddb',
  });
  // What beforeunload writes (use-autosave.ts): this tab's key, no scope.
  expect(writeAutosave(project('unload copy'), 1_020)).toMatchObject({ kind: 'ok' });
  await tab.stop();
}

type TestBrowser = { openTab(): AutosaveDurableService };

function testBrowser(): TestBrowser {
  const repository = new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `curvedesk-autosave-test-${crypto.randomUUID()}`,
  });
  const locks = new SharedLockManager();
  return {
    openTab() {
      // A new tab has empty sessionStorage; localStorage and IndexedDB persist.
      sessionStorage.clear();
      return new AutosaveDurableService({
        repository,
        locks: new AutosaveSessionLocks(locks.asLockManager()),
      });
    },
  };
}

function project(notes: string): Project {
  return { ...createProject(), notes };
}

class SharedLockManager {
  private readonly heldNames = new Set<string>();

  asLockManager(): LockManager {
    return { request: this.request.bind(this) } as LockManager;
  }

  private async request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    if (options.ifAvailable === true && this.heldNames.has(name)) return callback(null);
    this.heldNames.add(name);
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      this.heldNames.delete(name);
    }
  }
}
