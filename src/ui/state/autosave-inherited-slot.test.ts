// A reload of the same tab keeps the autosave session ID (sessionStorage). The
// reloaded page must leave the previous page's unsaved work where recovery can
// still find it, instead of writing over it or clearing it (audit D-1).

import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { writeAutosave } from './autosave';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import {
  autosaveStorageKeyForSession,
  currentAutosaveSessionId,
  replaceAutosaveSessionId,
} from './autosave-local-storage';
import { AutosaveSessionLocks } from './autosave-session-lock';

const UNSAVED = 'unsaved work from before the reload';

let factory: IDBFactory;
let databaseName: string;
let locks: AutosaveSessionLocks;
const pages: AutosaveDurableService[] = [];

beforeEach(() => {
  factory = new FakeIDBFactory();
  databaseName = `autosave-inherited-${crypto.randomUUID()}`;
  locks = new AutosaveSessionLocks(new TestLockManager().asLockManager());
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.stop()));
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('autosave after a reload of the same tab', () => {
  it('offers the earlier page work as an abandoned session and autosaves elsewhere', async () => {
    const { page, oldSessionId } = await reloadAfterUnsavedWork();

    const offer = (await page.readLatest()).snapshot;
    expect(offer).toMatchObject({
      project: { notes: UNSAVED },
      sessionId: oldSessionId,
      ownership: 'abandoned',
    });
    const session = await page.session();
    expect(session).toMatchObject({ ownership: 'owned' });
    expect(session.sessionId).not.toBe(oldSessionId);
    // Synchronous unload writes and clears follow sessionStorage.
    expect(currentAutosaveSessionId()).toBe(session.sessionId);
    await expect(page.write(project('new sketch'), 31_000)).resolves.toMatchObject({
      kind: 'ok',
      storageKey: autosaveStorageKeyForSession(session.sessionId),
    });
  });

  it('offers the earlier page work to both recovery reads that StrictMode starts', async () => {
    // Development runs the recovery effect twice. The second read probes the
    // earlier page's session while the first read still holds its lock.
    const { page, oldSessionId } = await reloadAfterUnsavedWork();
    const firstProbing = deferred();
    const firstDone = deferred();
    const probe = locks.runIfAbandoned.bind(locks);
    vi.spyOn(locks, 'runIfAbandoned').mockImplementationOnce(
      async <T>(sessionId: string, reconcile: () => Promise<T>) =>
        probe(sessionId, async () => {
          firstProbing.resolve();
          await firstDone.promise;
          return reconcile();
        }),
    );
    const reads = vi.spyOn(IndexedDbAutosaveRepository.prototype, 'readAllSlots');

    const first = page.readLatest();
    await firstProbing.promise;
    const second = page.readLatest();
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
    await reads.mock.results[1]?.value;
    await new Promise((resolve) => setTimeout(resolve, 0)); // the second read reaches its probe
    firstDone.resolve();

    for (const read of await Promise.all([first, second])) {
      expect(read.snapshot).toMatchObject({ sessionId: oldSessionId, ownership: 'abandoned' });
    }
  });

  it('keeps the earlier page work through edits and a manual save', async () => {
    const { page } = await reloadAfterUnsavedWork();
    await page.readLatest();

    await page.write(project('new sketch'), 31_000);
    await page.write(project('new sketch, more'), 61_000);
    expect(await page.clearCurrent()).toEqual({ kind: 'ok' });
    await page.stop();

    expect((await newTab().readLatest()).snapshot?.project.notes).toBe(UNSAVED);
  });

  it('keeps the earlier page work when the reloaded page opens a file first', async () => {
    const { page } = await reloadAfterUnsavedWork();

    expect(await page.clearCurrent()).toEqual({ kind: 'ok' });
    await page.stop();

    expect((await newTab().readLatest()).snapshot?.project.notes).toBe(UNSAVED);
  });

  it('keeps the earlier page unload backup from a clear that runs at startup', async () => {
    const before = pageLoad();
    const oldSessionId = (await before.session()).sessionId;
    // The synchronous beforeunload backup, written to localStorage.
    expect(writeAutosave(project(UNSAVED), 1_000).kind).toBe('ok');
    await before.stop();
    const page = pageLoad();

    const clearing = page.clearCurrent();
    expect(localStorage.getItem(autosaveStorageKeyForSession(oldSessionId))).toContain(UNSAVED);
    expect(await clearing).toEqual({ kind: 'ok' });
    expect((await page.readLatest()).snapshot).toMatchObject({
      project: { notes: UNSAVED },
      ownership: 'abandoned',
    });
  });

  it('moves restored work into the new slot and then clears the old one', async () => {
    const { page, oldSessionId } = await reloadAfterUnsavedWork();
    const offer = (await page.readLatest()).snapshot;
    if (offer === null) throw new Error('Expected the earlier page work.');

    // The Restore path of runAutosaveRecovery.
    const rehome = await page.write(offer.project);
    if (rehome.kind !== 'ok') throw new Error('Expected the restored work to autosave.');
    expect(rehome.storageKey).not.toBe(offer.storageKey);
    expect(await page.clearRecovered(offer, rehome.storageKey)).toEqual({ kind: 'ok' });

    const oldSlot = await repository().readSlot(autosaveStorageKeyForSession(oldSessionId));
    expect(oldSlot).toMatchObject({ current: null, previous: null });
    expect((await page.readLatest()).snapshot).toMatchObject({
      project: { notes: UNSAVED },
      storageKey: rehome.storageKey,
      ownership: 'current',
    });
  });

  it('keeps using an inherited slot that holds nothing', async () => {
    const before = pageLoad();
    await before.write(project('saved to a file later'), 1_000);
    expect(await before.clearCurrent()).toEqual({ kind: 'ok' });
    const sessionId = (await before.session()).sessionId;
    await before.stop();

    await expect(pageLoad().session()).resolves.toMatchObject({ sessionId, ownership: 'owned' });
  });

  it('publishes and holds the new session before releasing the inherited one', async () => {
    const { page, oldSessionId } = await reloadAfterUnsavedWork();
    const releasing = deferred();
    const gate = deferred();
    const claim = locks.claim.bind(locks);
    vi.spyOn(locks, 'claim').mockImplementationOnce(async (sessionId) => {
      const owned = await claim(sessionId);
      if (owned.kind !== 'owned') throw new Error('Expected to own the inherited session.');
      const release = async (): Promise<void> => {
        await owned.guard.release();
        releasing.resolve();
        await gate.promise;
      };
      return { ...owned, guard: { release } };
    });

    const claiming = page.session();
    try {
      await releasing.promise;
      const fresh = currentAutosaveSessionId();
      expect(fresh).not.toBe(oldSessionId);
      expect(await locks.claim(fresh)).toEqual({ kind: 'contended' });
    } finally {
      gate.resolve();
    }
    expect((await claiming).sessionId).toBe(currentAutosaveSessionId());
  });
});

// One page load, wired as production wires it: the session ID comes from
// sessionStorage, which a reload of the same tab keeps.
function pageLoad(): AutosaveDurableService {
  const page = new AutosaveDurableService({
    repository: repository(),
    locks,
    initialSessionId: currentAutosaveSessionId(),
    rotateSessionId: replaceAutosaveSessionId,
  });
  pages.push(page);
  return page;
}

// A new tab starts with empty sessionStorage.
function newTab(): AutosaveDurableService {
  sessionStorage.clear();
  return pageLoad();
}

async function reloadAfterUnsavedWork(): Promise<{
  readonly page: AutosaveDurableService;
  readonly oldSessionId: string;
}> {
  const before = pageLoad();
  await before.write(project(UNSAVED), 1_000);
  const oldSessionId = (await before.session()).sessionId;
  await before.stop(); // the page goes away and its session lock is released
  return { page: pageLoad(), oldSessionId };
}

function repository(): IndexedDbAutosaveRepository {
  return new IndexedDbAutosaveRepository({ factory, databaseName });
}

function project(notes: string): Project {
  return { ...createProject(), notes };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class TestLockManager {
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
