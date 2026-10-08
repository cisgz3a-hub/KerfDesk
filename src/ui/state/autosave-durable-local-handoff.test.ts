import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject } from '../../core/scene';
import { readAutosave, writeAutosave } from './autosave';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { AutosaveSessionLocks } from './autosave-session-lock';

const SESSION_ID = 'local-discard-handover';
const STORAGE_KEY = `lf2:autosave:v1:${SESSION_ID}`;
const services: AutosaveDurableService[] = [];
const releases: Array<() => void> = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('lf2:autosave:session-id:v1', SESSION_ID);
});

afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('queued autosave cleanup and a newer synchronous recovery copy', () => {
  it.each(['indexeddb', 'local'] as const)(
    'preserves newer unload bytes when the prior blocked write uses %s',
    async (backend) => {
      const { service, repository } = fixture();
      await service.session();
      const oldProject = { ...createProject(), notes: 'discarded snapshot' };
      expect(writeAutosave(oldProject, 100).kind).toBe('ok');
      const held = holdCommit(repository, backend);
      const writing = service.write(oldProject, 100);
      await held.started;

      const clearing = service.clearCurrent();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      // Editing while Discard waits retires New. The unload path is synchronous,
      // bypasses the service queue, and may share the earlier save timestamp.
      const newerProject = { ...oldProject, notes: 'edit made while Discard was waiting' };
      expect(writeAutosave(newerProject, 100).kind).toBe('ok');
      const newerRaw = localStorage.getItem(STORAGE_KEY);
      held.release();

      await expect(writing).resolves.toMatchObject(
        backend === 'local' ? { kind: 'superseded' } : { kind: 'ok', backend },
      );
      await expect(clearing).resolves.toEqual({ kind: 'ok' });
      expect(localStorage.getItem(STORAGE_KEY)).toBe(newerRaw);
      expect(readAutosave()?.project.notes).toBe(newerProject.notes);
      expect((await repository.readSlot(STORAGE_KEY))?.current).toBeNull();
      expect((await service.readLatest()).snapshot?.project.notes).toBe(newerProject.notes);
    },
  );

  it.each(['indexeddb', 'local'] as const)(
    'preserves a later publication of identical bytes after a blocked %s write',
    async (backend) => {
      const { service, repository } = fixture();
      const sameProject = { ...createProject(), notes: 'same data in the next recovery copy' };
      const held = holdCommit(repository, backend);
      const writing = service.write(sameProject, 100);
      await held.started;
      const clearing = service.clearCurrent();
      expect(writeAutosave(sameProject, 100).kind).toBe('ok');
      const newerRaw = localStorage.getItem(STORAGE_KEY);
      held.release();

      await writing;
      await expect(clearing).resolves.toEqual({ kind: 'ok' });
      expect(localStorage.getItem(STORAGE_KEY)).toBe(newerRaw);
      expect(readAutosave()?.project.notes).toBe(sameProject.notes);
    },
  );

  it('does not let a second already-queued fallback replace a later unload copy', async () => {
    const { service, repository } = fixture();
    const held = holdCommit(repository, 'local');
    const first = service.write({ ...createProject(), notes: 'first old interval' }, 100);
    await held.started;
    vi.spyOn(repository, 'commit').mockRejectedValue(new Error('IndexedDB unavailable'));
    const second = service.write({ ...createProject(), notes: 'second old interval' }, 100);
    const clearing = service.clearCurrent();
    expect(writeAutosave({ ...createProject(), notes: 'newest unload copy' }, 100).kind).toBe('ok');
    const newerRaw = localStorage.getItem(STORAGE_KEY);
    held.release();

    await expect(first).resolves.toEqual({ kind: 'superseded' });
    await expect(second).resolves.toEqual({ kind: 'superseded' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(newerRaw);
    expect(readAutosave()?.project.notes).toBe('newest unload copy');
  });

  it('preserves published unload bytes even if updating the discovery index fails', async () => {
    const { service, repository } = fixture();
    const held = holdCommit(repository, 'local');
    const writing = service.write({ ...createProject(), notes: 'older interval' }, 100);
    await held.started;
    const clearing = service.clearCurrent();
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(function (this: Storage, key, value) {
        setItem.call(this, key, value);
      })
      .mockImplementationOnce(() => {
        throw new DOMException('Index is full', 'QuotaExceededError');
      });

    expect(
      writeAutosave({ ...createProject(), notes: 'published despite index failure' }, 100),
    ).toMatchObject({ kind: 'failed', reason: 'quota' });
    const newerRaw = localStorage.getItem(STORAGE_KEY);
    expect(newerRaw).not.toBeNull();
    held.release();

    await expect(writing).resolves.toEqual({ kind: 'superseded' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(newerRaw);
    expect(readAutosave()?.project.notes).toBe('published despite index failure');
  });

  it('clears the earlier fallback without affecting another window synchronous copy', async () => {
    const { service, repository } = fixture();
    const held = holdCommit(repository, 'local');
    const writing = service.write({ ...createProject(), notes: 'discarded current window' }, 100);
    await held.started;
    const clearing = service.clearCurrent();
    const otherKey = 'lf2:autosave:v1:other-window';
    expect(
      writeAutosave({ ...createProject(), notes: 'other window work' }, 100, {
        sessionId: 'other-window',
      }).kind,
    ).toBe('ok');
    const otherRaw = localStorage.getItem(otherKey);
    held.release();

    await expect(writing).resolves.toMatchObject({ kind: 'ok', backend: 'local' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(otherKey)).toBe(otherRaw);
  });

  it('keeps a new fallback queued after the old document cleanup', async () => {
    const { service, repository } = fixture();
    const held = holdCommit(repository, 'local');
    const oldWrite = service.write({ ...createProject(), notes: 'old document' }, 100);
    await held.started;
    vi.spyOn(repository, 'commit').mockRejectedValue(new Error('IndexedDB unavailable'));
    const clearing = service.clearCurrent();
    const newWrite = service.write({ ...createProject(), notes: 'new document' }, 100);
    held.release();

    await expect(oldWrite).resolves.toMatchObject({ kind: 'ok', backend: 'local' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    await expect(newWrite).resolves.toMatchObject({ kind: 'ok', backend: 'local' });
    expect(readAutosave()?.project.notes).toBe('new document');
    expect((await service.readLatest()).snapshot?.project.notes).toBe('new document');
  });
  it('still retires the old fallback when the attempted unload write published no bytes', async () => {
    const { service, repository } = fixture();
    const held = holdCommit(repository, 'local');
    const writing = service.write({ ...createProject(), notes: 'late old fallback' }, 100);
    await held.started;
    const clearing = service.clearCurrent();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Slot is full', 'QuotaExceededError');
    });
    expect(writeAutosave({ ...createProject(), notes: 'not published' }, 100).kind).toBe('failed');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    held.release();

    await expect(writing).resolves.toMatchObject({ kind: 'ok', backend: 'local' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect((await service.readLatest()).snapshot).toBeNull();
  });
});

function fixture() {
  const repository = new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `autosave-local-handover-${crypto.randomUUID()}`,
  });
  const locks = new AutosaveSessionLocks(null);
  vi.spyOn(locks, 'claim').mockResolvedValue({
    kind: 'owned',
    guard: { release: async () => undefined },
  });
  const service = new AutosaveDurableService({ repository, locks, initialSessionId: SESSION_ID });
  services.push(service);
  return { service, repository };
}

function holdCommit(repository: IndexedDbAutosaveRepository, backend: 'indexeddb' | 'local') {
  const started = deferred<undefined>();
  const gate = deferred<undefined>();
  const commit = repository.commit.bind(repository);
  vi.spyOn(repository, 'commit').mockImplementationOnce(async (...args) => {
    started.resolve(undefined);
    await gate.promise;
    if (backend === 'local') throw new Error('IndexedDB unavailable');
    return commit(...args);
  });
  const release = () => gate.resolve(undefined);
  releases.push(release);
  return { started: started.promise, release };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
