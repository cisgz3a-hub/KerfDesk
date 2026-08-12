import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { IndexedDbAutosaveRepository, type AutosaveIndexedDbRecord } from './autosave-indexeddb';
import {
  AUTOSAVE_MANIFEST_STORE,
  AUTOSAVE_SNAPSHOT_STORE,
  autosaveRequest,
  autosaveTransactionFinished,
  openAutosaveDatabase,
} from './autosave-indexeddb-runtime';

const SESSION_A = 'window-a';
const SESSION_B = 'window-b';
const STORAGE_A = 'lf2:autosave:v1:window-a';

describe('IndexedDbAutosaveRepository', () => {
  it('atomically rotates current and previous snapshots', async () => {
    const repository = testRepository();

    await expect(repository.commit(record('first', 100), 0)).resolves.toEqual({
      kind: 'committed',
      epoch: 1,
    });
    await expect(repository.commit(record('second', 200), 1)).resolves.toEqual({
      kind: 'committed',
      epoch: 2,
    });

    const slot = await repository.readSlot(STORAGE_A);
    expect(slot).toMatchObject({ epoch: 2 });
    expect(slot?.current?.projectJson).toBe('second');
    expect(slot?.previous?.projectJson).toBe('first');
  });

  it('preserves the prior manifest and both snapshots when replacement aborts', async () => {
    let abortNextCommit = false;
    const repository = testRepository({
      beforeCommit: (operation, transaction) => {
        if (operation === 'commit' && abortNextCommit) transaction.abort();
      },
    });
    await repository.commit(record('first', 100), 0);
    await repository.commit(record('second', 200), 1);
    abortNextCommit = true;

    await expect(repository.commit(record('third', 300), 2)).rejects.toThrow(
      'Autosave transaction aborted',
    );

    const slot = await repository.readSlot(STORAGE_A);
    expect(slot?.current?.projectJson).toBe('second');
    expect(slot?.previous?.projectJson).toBe('first');
  });

  it('allows only one compare-and-swap writer at the same epoch', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const first = new IndexedDbAutosaveRepository({ factory, databaseName });
    const second = new IndexedDbAutosaveRepository({ factory, databaseName });

    const results = await Promise.all([
      first.commit(record('first contender', 100), 0),
      second.commit(record('second contender', 200), 0),
    ]);

    expect(results.filter((result) => result.kind === 'committed')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'conflict')).toHaveLength(1);
    expect((await first.readSlot(STORAGE_A))?.epoch).toBe(1);
  });

  it('retains an epoch tombstone so a late writer cannot recreate a cleared slot', async () => {
    const repository = testRepository();
    await repository.commit(record('before save', 100), 0);

    await expect(repository.clear(clearInput(STORAGE_A, SESSION_A, 1))).resolves.toEqual({
      kind: 'committed',
      epoch: 2,
    });
    await expect(repository.commit(record('late write', 200), 1)).resolves.toEqual({
      kind: 'conflict',
      expectedEpoch: 1,
      actualEpoch: 2,
    });
    expect(await repository.readSlot(STORAGE_A)).toMatchObject({
      epoch: 2,
      current: null,
      previous: null,
    });

    await expect(repository.commit(record('new edit', 300), 2)).resolves.toEqual({
      kind: 'committed',
      epoch: 3,
    });
    expect((await repository.readSlot(STORAGE_A))?.current?.projectJson).toBe('new edit');
  });

  it('preserves both snapshots when a clear transaction aborts', async () => {
    let abortClear = false;
    const repository = testRepository({
      beforeCommit: (operation, transaction) => {
        if (operation === 'clear' && abortClear) transaction.abort();
      },
    });
    await repository.commit(record('first', 100), 0);
    await repository.commit(record('second', 200), 1);
    abortClear = true;

    await expect(repository.clear(clearInput(STORAGE_A, SESSION_A, 2))).rejects.toThrow(
      'Autosave transaction aborted',
    );

    const slot = await repository.readSlot(STORAGE_A);
    expect(slot?.current?.projectJson).toBe('second');
    expect(slot?.previous?.projectJson).toBe('first');
  });

  it('keeps independent window sessions and their epochs separate', async () => {
    const repository = testRepository();
    await repository.commit(record('first window', 100), 0);
    await repository.commit(
      record('second window', 200, { sessionId: SESSION_B, storageKey: `${STORAGE_A}b` }),
      0,
    );

    await repository.clear(clearInput(`${STORAGE_A}b`, SESSION_B, 1));

    expect((await repository.readSlot(STORAGE_A))?.current?.projectJson).toBe('first window');
    expect(await repository.readSlot(`${STORAGE_A}b`)).toMatchObject({ epoch: 2 });
    expect(await repository.readAllSlots()).toHaveLength(2);
  });

  it('isolates a malformed manifest without hiding valid recovery slots', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const repository = new IndexedDbAutosaveRepository({ factory, databaseName });
    await repository.commit(record('valid recovery', 100), 0);
    const database = await openAutosaveDatabase(factory, databaseName);
    const transaction = database.transaction(AUTOSAVE_MANIFEST_STORE, 'readwrite');
    await autosaveRequest(
      transaction.objectStore(AUTOSAVE_MANIFEST_STORE).put({
        kind: 'malformed',
        storageKey: 'bad-key',
        sessionId: 'bad-session',
      }),
    );
    await autosaveTransactionFinished(transaction);

    const slots = await repository.readAllSlots();
    expect(slots).toHaveLength(2);
    expect(slots.find((slot) => slot.storageKey === STORAGE_A)?.current?.projectJson).toBe(
      'valid recovery',
    );
    expect(slots.find((slot) => slot.storageKey === 'bad-key')).toMatchObject({
      currentExpected: true,
      current: null,
    });
    database.close();
  });

  it('rejects a snapshot whose session identity differs from its manifest', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const repository = new IndexedDbAutosaveRepository({ factory, databaseName });
    await repository.commit(record('owned by window a', 100), 0);
    const database = await openAutosaveDatabase(factory, databaseName);
    const transaction = database.transaction(AUTOSAVE_SNAPSHOT_STORE, 'readwrite');
    const snapshots = transaction.objectStore(AUTOSAVE_SNAPSHOT_STORE);
    const stored = await autosaveRequest<Record<string, unknown>>(snapshots.get([STORAGE_A, 1]));
    await autosaveRequest(snapshots.put({ ...stored, sessionId: 'reader-window' }));
    await autosaveTransactionFinished(transaction);

    expect(await repository.readSlot(STORAGE_A)).toMatchObject({
      sessionId: SESSION_A,
      currentExpected: true,
      current: null,
    });
    database.close();
  });

  it('isolates a manifest whose current and previous references contradict its epoch', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const repository = new IndexedDbAutosaveRepository({ factory, databaseName });
    await repository.commit(record('older recovery', 100), 0);
    await repository.commit(record('newer recovery', 200), 1);
    const database = await openAutosaveDatabase(factory, databaseName);
    const transaction = database.transaction(AUTOSAVE_MANIFEST_STORE, 'readwrite');
    const manifests = transaction.objectStore(AUTOSAVE_MANIFEST_STORE);
    const stored = await autosaveRequest<Record<string, unknown>>(manifests.get(STORAGE_A));
    await autosaveRequest(
      manifests.put({ ...stored, current: stored['previous'], previous: stored['current'] }),
    );
    await autosaveTransactionFinished(transaction);

    expect(await repository.readAllSlots()).toContainEqual(
      expect.objectContaining({ storageKey: STORAGE_A, currentExpected: true, current: null }),
    );
    database.close();
  });

  it('reports unavailable IndexedDB factually', async () => {
    const repository = new IndexedDbAutosaveRepository({ factory: undefined });

    await expect(repository.readAllSlots()).rejects.toThrow('IndexedDB is unavailable');
  });

  it('contains a throwing ambient IndexedDB getter as an unavailable backend', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get: () => {
        throw new DOMException('IndexedDB blocked', 'SecurityError');
      },
    });
    try {
      const repository = new IndexedDbAutosaveRepository();
      await expect(repository.readAllSlots()).rejects.toThrow('IndexedDB is unavailable');
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    }
  });
});

function record(
  projectJson: string,
  savedAt: number,
  overrides: Partial<AutosaveIndexedDbRecord> = {},
): AutosaveIndexedDbRecord {
  return {
    schemaVersion: 1,
    sessionId: SESSION_A,
    storageKey: STORAGE_A,
    savedAt,
    projectJson,
    ...overrides,
  };
}

function clearInput(storageKey: string, sessionId: string, expectedEpoch: number) {
  return { storageKey, sessionId, expectedEpoch };
}

type TestRepositoryOptions = {
  readonly beforeCommit?: (operation: 'commit' | 'clear', transaction: IDBTransaction) => void;
};

function testRepository(options: TestRepositoryOptions = {}): IndexedDbAutosaveRepository {
  return new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `curvedesk-autosave-test-${crypto.randomUUID()}`,
    beforeCommit: options.beforeCommit,
  });
}
