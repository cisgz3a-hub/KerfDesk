import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { autosaveStorageKeyForSession } from './autosave-local-storage';
import { AutosaveSessionLocks } from './autosave-session-lock';

const SESSION = 'retirement-race-window';
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

it('preserves a successful local fallback written while recovery is reading storage', async () => {
  const { service, repository } = setup();
  localStorage.setItem(STORAGE_KEY, '{incomplete');
  const read = pauseNextRead(repository);
  vi.spyOn(repository, 'commit').mockRejectedValue(new Error('IndexedDB writes unavailable'));

  const recovery = service.readLatest();
  await read.started;
  try {
    const write = await service.write({ ...createProject(), notes: 'new local backup' }, 200);
    expect(write).toMatchObject({ kind: 'ok', backend: 'local' });
    expect(localStorage.getItem(STORAGE_KEY)).toContain('new local backup');
  } finally {
    read.release();
  }
  await recovery;

  expect(localStorage.getItem(STORAGE_KEY)).toContain('new local backup');
  expect((await service.readLatest()).snapshot?.project.notes).toBe('new local backup');
});

it('preserves a newer IndexedDB epoch written after an unreadable snapshot was scanned', async () => {
  const { service, repository } = setup();
  await service.write({ ...createProject(), notes: 'lost snapshot' }, 100);
  await stripSnapshotRows(repository);
  const read = pauseNextRead(repository);

  const recovery = service.readLatest();
  await read.started;
  try {
    const write = await service.write({ ...createProject(), notes: 'new durable backup' }, 200);
    expect(write).toMatchObject({ kind: 'ok', backend: 'indexeddb' });
    expect(await repository.readEpoch(STORAGE_KEY)).toBe(2);
  } finally {
    read.release();
  }
  await recovery;

  expect(await repository.readEpoch(STORAGE_KEY)).toBe(2);
  expect((await service.readLatest()).snapshot?.project.notes).toBe('new durable backup');
});

function pauseNextRead(repository: IndexedDbAutosaveRepository): {
  readonly started: Promise<void>;
  readonly release: () => void;
} {
  let notifyStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readAllSlots = repository.readAllSlots.bind(repository);
  vi.spyOn(repository, 'readAllSlots').mockImplementationOnce(async () => {
    const slots = await readAllSlots();
    notifyStarted();
    await gate;
    return slots;
  });
  return { started, release };
}

async function stripSnapshotRows(repository: IndexedDbAutosaveRepository): Promise<void> {
  const access = repository as unknown as { database(): Promise<IDBDatabase> };
  const database = await access.database();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('snapshots', 'readwrite');
    transaction.objectStore('snapshots').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Snapshot clear failed.'));
  });
}

function setup(): {
  readonly service: AutosaveDurableService;
  readonly repository: IndexedDbAutosaveRepository;
} {
  const repository = new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `autosave-retirement-race-${crypto.randomUUID()}`,
  });
  const manager = {
    request: async (name: string, _options: LockOptions, callback: (lock: Lock) => unknown) =>
      callback({ name, mode: 'exclusive' } as Lock),
  } as unknown as LockManager;
  const service = new AutosaveDurableService({
    repository,
    locks: new AutosaveSessionLocks(manager),
    initialSessionId: SESSION,
  });
  services.push(service);
  return { service, repository };
}
