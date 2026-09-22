import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { serializeProject } from '../../io/project/serialize-project';
import { clearAutosave, writeAutosave } from './autosave';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { autosaveStorageKeyForSession, replaceAutosaveSessionId } from './autosave-local-storage';
import { UnsupportedAutosaveVersionError } from './autosave-record';
import { AutosaveSessionLocks } from './autosave-session-lock';

const SESSION = 'newer-build-window';
const STORAGE_KEY = autosaveStorageKeyForSession(SESSION);
const services: AutosaveDurableService[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('unsupported autosave project versions', () => {
  it.each(['local', 'indexeddb'] as const)(
    'retains an abandoned newer-version backup in %s storage',
    async (backend) => {
      const { repository, service } = setup('older-reader');
      const record = newerRecord();
      if (backend === 'local') localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      else await repository.commit(record, 0);

      const read = await service.readLatest();

      expect(read.snapshot).toBeNull();
      if (backend === 'local')
        expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(record));
      else expect((await repository.readSlot(STORAGE_KEY))?.current).toEqual(record);
      expect(read.warnings).toEqual(['unsupported-version']);
      expect(read.unreadable).toEqual([]);
    },
  );

  it.each(['local', 'indexeddb'] as const)(
    'preserves the current session backup across cleanup and later writes in %s',
    async (backend) => {
      const { repository, service } = setup();
      const record = newerRecord();
      await seed(backend, repository, record);

      // No recovery scan has run: writes and manual-save cleanup must defend
      // the persisted bytes independently of read-time classification.
      expect(await service.clearCurrent()).toEqual({
        kind: 'retained',
        reason: 'unsupported-version',
      });
      const write = await service.write(
        { ...createProject(), notes: 'work in the older build' },
        200,
      );
      expect(write).toMatchObject({ kind: 'ok', backend: 'indexeddb' });
      if (write.kind !== 'ok') throw new Error('Expected the new work to autosave.');
      expect(write.storageKey).not.toBe(STORAGE_KEY);
      expect((await service.readLatest()).snapshot?.project.notes).toBe('work in the older build');
      await service.clearCurrent();
      await expectPreserved(backend, repository, record);
    },
  );

  it('preserves the synchronous unload backup even before the durable service claims a session', () => {
    sessionStorage.setItem('lf2:autosave:session-id:v1', SESSION);
    const raw = JSON.stringify(newerRecord());
    localStorage.setItem(STORAGE_KEY, raw);

    expect(writeAutosave(createProject())).toMatchObject({
      kind: 'failed',
      error: expect.any(UnsupportedAutosaveVersionError),
    });
    expect(clearAutosave()).toMatchObject({ kind: 'failed' });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('rotates the session and continues local fallback when IndexedDB is unavailable', async () => {
    const { repository, service } = setup();
    const raw = JSON.stringify(newerRecord());
    localStorage.setItem(STORAGE_KEY, raw);
    vi.spyOn(repository, 'commit').mockRejectedValue(new Error('IndexedDB unavailable'));

    const write = await service.write({ ...createProject(), notes: 'new fallback' });

    expect(write).toMatchObject({ kind: 'ok', backend: 'local' });
    if (write.kind !== 'ok') throw new Error('Expected the new work to autosave.');
    expect(write.storageKey).not.toBe(STORAGE_KEY);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(localStorage.getItem(write.storageKey)).toContain('new fallback');
  });

  it('does not recover the previous generation in place of a newer-version current snapshot', async () => {
    const { repository, service } = setup();
    await repository.commit(
      { ...newerRecord(), projectJson: serializeProject(createProject()) },
      0,
    );
    await repository.commit(newerRecord(), 1);

    const read = await service.readLatest();

    expect(read.snapshot).toBeNull();
    expect(read.warnings).toEqual(['unsupported-version']);
    expect(read.unreadable).toEqual([]);
    expect((await repository.readSlot(STORAGE_KEY))?.epoch).toBe(2);
  });

  it.each([1, 2])(
    'protects unsupported IndexedDB generation %i during direct mutations',
    async (epoch) => {
      const { repository } = setup();
      const record = { ...newerRecord(), projectJson: serializeProject(createProject()) };
      await repository.commit(record, 0);
      await repository.commit({ ...record, savedAt: 200 }, 1);
      await patchSnapshot(repository, epoch, { projectJson: newerRecord().projectJson });
      const before = await repository.readSlot(STORAGE_KEY);

      await expect(repository.commit(record, 2)).rejects.toBeInstanceOf(
        UnsupportedAutosaveVersionError,
      );
      await expect(
        repository.clear({ storageKey: STORAGE_KEY, sessionId: SESSION, expectedEpoch: 2 }),
      ).rejects.toBeInstanceOf(UnsupportedAutosaveVersionError);

      expect(await repository.readSlot(STORAGE_KEY)).toEqual(before);
    },
  );

  it.each(['project', 'envelope'] as const)(
    'recovers a compatible current snapshot while retaining an unsupported previous %s',
    async (unsupported) => {
      const { repository, service } = setup();
      const record = { ...newerRecord(), projectJson: serializeProject(createProject()) };
      await repository.commit(record, 0);
      await repository.commit(
        {
          ...record,
          savedAt: 200,
          projectJson: serializeProject({ ...createProject(), notes: 'newest compatible work' }),
        },
        1,
      );
      await patchSnapshot(
        repository,
        1,
        unsupported === 'project'
          ? { projectJson: newerRecord().projectJson }
          : { schemaVersion: 2 },
      );
      const previous = await snapshotRow(repository, 1);

      const read = await service.readLatest();

      expect(read.snapshot?.project.notes).toBe('newest compatible work');
      expect(read.warnings).toEqual(['unsupported-version']);
      expect(read.unreadable).toEqual([]);
      if (read.snapshot === null) throw new Error('Expected a compatible recovery.');
      const write = await service.write(read.snapshot.project);
      if (write.kind !== 'ok') throw new Error('Expected to rehome the compatible recovery.');
      expect(write.storageKey).not.toBe(STORAGE_KEY);
      expect(await service.clearRecovered(read.snapshot, write.storageKey)).toEqual({
        kind: 'retained',
        reason: 'unsupported-version',
      });
      expect(await snapshotRow(repository, 1)).toEqual(previous);
      expect((await repository.readSlot(STORAGE_KEY))?.current?.savedAt).toBe(200);
    },
  );

  it.each(['local', 'indexeddb'] as const)(
    'retains a newer %s envelope as well as the project schema',
    async (backend) => {
      const { repository, service } = setup();
      const record = { ...newerRecord(), projectJson: serializeProject(createProject()) };
      if (backend === 'local')
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...record, schemaVersion: 2 }));
      else {
        await repository.commit(record, 0);
        await patchSnapshot(repository, 1, { schemaVersion: 2 });
      }

      const read = await service.readLatest();
      expect(read.warnings).toEqual(['unsupported-version']);
      expect(read.unreadable).toEqual([]);
      expect(read.snapshot).toBeNull();
      expect((await service.write(createProject())).kind).toBe('ok');
      if (backend === 'local') {
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
          ...record,
          schemaVersion: 2,
        });
      } else {
        expect((await repository.readSlot(STORAGE_KEY))?.epoch).toBe(1);
        expect(await snapshotRow(repository, 1)).toMatchObject({ ...record, schemaVersion: 2 });
      }
    },
  );

  it('preserves an unsupported version replacing an observed corrupt local record during recovery', async () => {
    const { repository, service } = setup();
    localStorage.setItem(STORAGE_KEY, '{incomplete');
    let release = (): void => undefined;
    let started = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const readAllSlots = repository.readAllSlots.bind(repository);
    vi.spyOn(repository, 'readAllSlots').mockImplementationOnce(async () => {
      const slots = await readAllSlots();
      started();
      await gate;
      return slots;
    });
    const recovery = service.readLatest();
    await ready;
    const raw = JSON.stringify(newerRecord());
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      expect((await service.write(createProject())).kind).toBe('ok');
    } finally {
      release();
    }
    await recovery;

    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect((await service.readLatest()).warnings).toEqual(['unsupported-version']);
  });

  it('preserves a newer IndexedDB manifest when a stale build reuses the same session', async () => {
    const { repository, service } = setup();
    const record = { ...newerRecord(), projectJson: serializeProject(createProject()) };
    await repository.commit(record, 0);
    const database = await (
      repository as unknown as { database(): Promise<IDBDatabase> }
    ).database();
    const transaction = database.transaction('manifests', 'readwrite');
    const store = transaction.objectStore('manifests');
    const request = store.get(STORAGE_KEY);
    request.onsuccess = () => {
      const manifest: unknown = request.result;
      store.put({ ...(manifest as object), schemaVersion: 2 });
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Manifest write failed.'));
    });

    const read = await service.readLatest();
    expect(read.warnings).toEqual(['unsupported-version']);
    expect(read.unreadable).toEqual([]);
    expect(await service.clearCurrent()).toEqual({
      kind: 'retained',
      reason: 'unsupported-version',
    });
    const write = await service.write(createProject());
    expect(write).toMatchObject({ kind: 'ok', backend: 'indexeddb' });
    if (write.kind !== 'ok') throw new Error('Expected the new work to autosave.');
    expect(write.storageKey).not.toBe(STORAGE_KEY);
    expect(await snapshotRow(repository, 1)).toMatchObject(record);
    expect(
      (await repository.readAllSlots()).find((slot) => slot.storageKey === STORAGE_KEY),
    ).toMatchObject({ unsupportedVersion: true });
  });

  it('retains a project whose older schema has no supported migration', async () => {
    const { service } = setup();
    const record = {
      ...newerRecord(),
      projectJson: '{"schemaVersion":0,"notes":"old unsaved work"}',
    };
    const raw = JSON.stringify(record);
    localStorage.setItem(STORAGE_KEY, raw);
    expect((await service.readLatest()).warnings).toEqual(['unsupported-version']);
    expect((await service.write(createProject())).kind).toBe('ok');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
});

async function seed(
  backend: 'local' | 'indexeddb',
  repository: IndexedDbAutosaveRepository,
  record: ReturnType<typeof newerRecord>,
) {
  if (backend === 'local') localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  else await repository.commit(record, 0);
}

async function expectPreserved(
  backend: 'local' | 'indexeddb',
  repository: IndexedDbAutosaveRepository,
  record: ReturnType<typeof newerRecord>,
) {
  if (backend === 'local') expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(record));
  else expect((await repository.readSlot(STORAGE_KEY))?.current).toEqual(record);
}

async function snapshotRow(repository: IndexedDbAutosaveRepository, epoch: number) {
  const database = await (repository as unknown as { database(): Promise<IDBDatabase> }).database();
  const transaction = database.transaction('snapshots', 'readonly');
  return new Promise<unknown>((resolve, reject) => {
    const request = transaction.objectStore('snapshots').get([STORAGE_KEY, epoch]);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Snapshot read failed.'));
  });
}

async function patchSnapshot(
  repository: IndexedDbAutosaveRepository,
  epoch: number,
  patch: object,
) {
  const value = await snapshotRow(repository, epoch);
  const database = await (repository as unknown as { database(): Promise<IDBDatabase> }).database();
  const transaction = database.transaction('snapshots', 'readwrite');
  transaction.objectStore('snapshots').put({ ...(value as object), ...patch });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Snapshot write failed.'));
  });
}

function newerRecord() {
  const project: unknown = JSON.parse(serializeProject(createProject()));
  return {
    schemaVersion: 1 as const,
    sessionId: SESSION,
    storageKey: STORAGE_KEY,
    savedAt: 100,
    projectJson: JSON.stringify({
      ...(project as object),
      schemaVersion: PROJECT_SCHEMA_VERSION + 1,
    }),
  };
}

function setup(initialSessionId = SESSION) {
  sessionStorage.setItem('lf2:autosave:session-id:v1', initialSessionId);
  const repository = new IndexedDbAutosaveRepository({
    factory: new IDBFactory(),
    databaseName: `autosave-version-${crypto.randomUUID()}`,
  });
  const manager = {
    request: async (name: string, _options: LockOptions, callback: (lock: Lock) => unknown) =>
      callback({ name, mode: 'exclusive' } as Lock),
  } as unknown as LockManager;
  const service = new AutosaveDurableService({
    repository,
    locks: new AutosaveSessionLocks(manager),
    initialSessionId,
    rotateSessionId: replaceAutosaveSessionId,
  });
  services.push(service);
  return { repository, service };
}
