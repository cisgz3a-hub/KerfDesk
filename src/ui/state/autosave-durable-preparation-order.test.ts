import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject } from '../../core/scene';
import { readAutosave } from './autosave';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { prepareAutosaveRecordOffThread } from './autosave-preparation-client';
import { prepareAutosaveRecord, type AutosavePreparation } from './autosave-record';
import { AutosaveSessionLocks } from './autosave-session-lock';

vi.mock('./autosave-preparation-client', () => ({
  prepareAutosaveRecordOffThread: vi.fn(),
}));

const SESSION_ID = 'pending-preparation-test';
const STORAGE_KEY = `lf2:autosave:v1:${SESSION_ID}`;
type PreparationArguments = Parameters<typeof prepareAutosaveRecordOffThread>;

describe('durable autosave with pending worker preparation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('lf2:autosave:session-id:v1', SESSION_ID);
    vi.mocked(prepareAutosaveRecordOffThread).mockReset();
    vi.mocked(prepareAutosaveRecordOffThread).mockImplementation(async (...args) =>
      prepareAutosaveRecord(...args),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('queues clear behind preparation before reading an epoch or committing a stale snapshot', async () => {
    const { service, repository } = fixture();
    const readEpoch = vi.spyOn(repository, 'readEpoch');
    const commit = vi.spyOn(repository, 'commit');
    const clear = vi.spyOn(repository, 'clear');
    const held = holdPreparation();
    const writing = service.write({ ...createProject(), notes: 'cleared document' }, 100);
    const args = await held.started;
    const clearing = service.clearCurrent();

    expect(args.slice(1)).toEqual([100, SESSION_ID, STORAGE_KEY]);
    expect(readEpoch).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    held.finish(prepareAutosaveRecord(...args));

    await expect(writing).resolves.toMatchObject({ kind: 'ok', backend: 'indexeddb' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0]!);
    expect(await repository.readSlot(STORAGE_KEY)).toMatchObject({ current: null, previous: null });
    expect((await service.readLatest()).snapshot).toBeNull();
    expect(readAutosave()).toBeNull();
    await service.stop();
  });

  it('removes a fallback created after a clear was queued during preparation', async () => {
    const { service, repository } = fixture();
    vi.spyOn(repository, 'commit').mockRejectedValueOnce(new Error('IndexedDB write failed.'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const held = holdPreparation();
    const writing = service.write({ ...createProject(), notes: 'late fallback' }, 100);
    const args = await held.started;
    const clearing = service.clearCurrent();
    const prepared = prepareAutosaveRecord(...args);
    expect(prepared.kind).toBe('ok');
    held.finish(prepared);

    await expect(writing).resolves.toMatchObject({ kind: 'ok', backend: 'local' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    const fallback = setItem.mock.calls.find(([key]) => key === STORAGE_KEY);
    expect(fallback).toBeDefined();
    if (prepared.kind === 'ok') expect(JSON.parse(fallback![1])).toEqual(prepared.record);
    expect(prepareAutosaveRecordOffThread).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect((await service.readLatest()).snapshot).toBeNull();
    await service.stop();
  });

  it('preserves the new document when a write is queued after clearing a pending old document', async () => {
    const { service, repository } = fixture();
    const commit = vi.spyOn(repository, 'commit');
    const clear = vi.spyOn(repository, 'clear');
    const held = holdPreparation();
    const oldWrite = service.write({ ...createProject(), notes: 'old document' }, 100);
    const args = await held.started;
    const clearing = service.clearCurrent();
    const newWrite = service.write({ ...createProject(), notes: 'new document' }, 200);
    expect(prepareAutosaveRecordOffThread).toHaveBeenCalledTimes(1);
    held.finish(prepareAutosaveRecord(...args));

    await expect(oldWrite).resolves.toMatchObject({ kind: 'ok' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    await expect(newWrite).resolves.toMatchObject({ kind: 'ok', savedAt: 200 });
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0]!);
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[1]!);
    const slot = await repository.readSlot(STORAGE_KEY);
    expect(slot?.previous).toBeNull();
    expect(slot?.current?.savedAt).toBe(200);
    expect((await service.readLatest()).snapshot?.project.notes).toBe('new document');
    await service.stop();
  });

  it('holds the session guard until both pending preparation and its durable commit finish', async () => {
    const { service, repository, release } = fixture();
    const held = holdPreparation();
    const commitStarted = deferred<undefined>();
    const commitGate = deferred<undefined>();
    const originalCommit = repository.commit.bind(repository);
    vi.spyOn(repository, 'commit').mockImplementationOnce(async (...args) => {
      commitStarted.resolve(undefined);
      await commitGate.promise;
      return originalCommit(...args);
    });
    const writing = service.write(createProject(), 100);
    const args = await held.started;
    const stopping = service.stop();
    expect(release).not.toHaveBeenCalled();
    held.finish(prepareAutosaveRecord(...args));
    await commitStarted.promise;
    expect(release).not.toHaveBeenCalled();
    commitGate.resolve(undefined);

    await expect(writing).resolves.toMatchObject({ kind: 'ok' });
    await stopping;
    expect(release).toHaveBeenCalledTimes(1);
    expect((await repository.readSlot(STORAGE_KEY))?.current?.savedAt).toBe(100);
  });

  it.each(['invalid-project', 'storage-error'] as const)(
    'reports a %s preparation failure without writing and permits a later valid retry',
    async (reason) => {
      const { service, repository } = fixture();
      const readEpoch = vi.spyOn(repository, 'readEpoch');
      const commit = vi.spyOn(repository, 'commit');
      const held = holdPreparation();
      const writing = service.write(createProject(), 100);
      await held.started;
      const failure: AutosavePreparation = { kind: 'failed', reason, error: new Error(reason) };
      held.finish(failure);

      await expect(writing).resolves.toEqual(failure);
      expect(readEpoch).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      await expect(service.write(createProject(), 200)).resolves.toMatchObject({
        kind: 'ok',
        savedAt: 200,
        backend: 'indexeddb',
      });
      expect(commit).toHaveBeenCalledTimes(1);
      await service.stop();
    },
  );
});

function fixture() {
  const repository = new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `autosave-worker-order-${crypto.randomUUID()}`,
  });
  const locks = new AutosaveSessionLocks(null);
  const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  vi.spyOn(locks, 'claim').mockResolvedValue({ kind: 'owned', guard: { release } });
  const service = new AutosaveDurableService({ repository, locks, initialSessionId: SESSION_ID });
  return { service, repository, release };
}

function holdPreparation() {
  const started = deferred<PreparationArguments>();
  const result = deferred<AutosavePreparation>();
  vi.mocked(prepareAutosaveRecordOffThread).mockImplementationOnce((...args) => {
    started.resolve(args);
    return result.promise;
  });
  return { started: started.promise, finish: result.resolve };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
