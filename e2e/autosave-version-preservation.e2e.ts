import { expect, test, type Page } from '@playwright/test';

type StoredCase = 'local' | 'indexeddb' | 'compatible-current';

for (const storedCase of ['local', 'indexeddb', 'compatible-current'] as const) {
  test(`native autosave preserves ${storedCase} version history across reads, writes and clear`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.route('**/autosave-version-probe', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Autosave version probe</title>',
      }),
    );
    await page.goto('/autosave-version-probe');
    const result = await exerciseNativeAutosave(page, storedCase);

    expect(result.initialSession).toMatchObject({ ownership: 'owned' });
    expect(result.initialLockHeld).toBe(true);
    expect(result.readWarnings).toEqual(['unsupported-version']);
    expect(result.readNotes).toBe(
      storedCase === 'compatible-current' ? 'supported saved latest' : null,
    );
    expect(result.preservedAfterRead).toBe(true);
    expect(result.write).toMatchObject({ kind: 'ok', backend: 'indexeddb' });
    expect(result.rotatedSession.ownership).toBe('owned');
    expect(result.rotatedSession.sessionId).not.toBe(result.initialSession.sessionId);
    expect(result.oldLockReleased).toBe(true);
    expect(result.newLockHeld).toBe(true);
    expect(result.preservedAfterWrite).toBe(true);
    expect(result.latestNotes).toBe('current build work');
    expect(result.clear).toEqual({ kind: 'ok' });
    expect(result.preservedAfterClear).toBe(true);
    expect(result.clearedCurrentSlot).toMatchObject({ current: null, previous: null });
  });
}

async function exerciseNativeAutosave(page: Page, storedCase: StoredCase) {
  return page.evaluate(async (kind) => {
    const durablePath = '/src/ui/state/autosave-durable.ts';
    const repositoryPath = '/src/ui/state/autosave-indexeddb.ts';
    const projectPath = '/src/core/scene/project.ts';
    const serializePath = '/src/io/project/serialize-project.ts';
    const localPath = '/src/ui/state/autosave-local-storage.ts';
    const locksPath = '/src/ui/state/autosave-session-lock.ts';
    const { AutosaveDurableService } = (await import(
      /* @vite-ignore */ durablePath
    )) as typeof import('../src/ui/state/autosave-durable');
    const { IndexedDbAutosaveRepository } = (await import(
      /* @vite-ignore */ repositoryPath
    )) as typeof import('../src/ui/state/autosave-indexeddb');
    const { createProject, PROJECT_SCHEMA_VERSION } = (await import(
      /* @vite-ignore */ projectPath
    )) as typeof import('../src/core/scene/project');
    const { serializeProject } = (await import(
      /* @vite-ignore */ serializePath
    )) as typeof import('../src/io/project/serialize-project');
    const { autosaveStorageKeyForSession } = (await import(
      /* @vite-ignore */ localPath
    )) as typeof import('../src/ui/state/autosave-local-storage');
    const { autosaveSessionLockName } = (await import(
      /* @vite-ignore */ locksPath
    )) as typeof import('../src/ui/state/autosave-session-lock');

    if (navigator.locks === undefined || indexedDB === undefined) {
      throw new Error('Native Web Locks and IndexedDB are required for this regression.');
    }
    const sessionId = `version-preservation-${crypto.randomUUID()}`;
    sessionStorage.setItem('lf2:autosave:session-id:v1', sessionId);
    const storageKey = autosaveStorageKeyForSession(sessionId);
    const databaseName = `autosave-version-browser-${crypto.randomUUID()}`;
    const repository = new IndexedDbAutosaveRepository({ databaseName });
    const project: unknown = JSON.parse(serializeProject(createProject()));
    const futureProjectJson = JSON.stringify({
      ...(project as object),
      schemaVersion: PROJECT_SCHEMA_VERSION + 1,
    });
    const record = {
      schemaVersion: 1 as const,
      sessionId,
      storageKey,
      savedAt: 100,
      projectJson: futureProjectJson,
    };
    if (kind === 'local') localStorage.setItem(storageKey, JSON.stringify(record));
    else if (kind === 'indexeddb') await repository.commit(record, 0);
    else {
      await repository.commit({ ...record, projectJson: serializeProject(createProject()) }, 0);
      await repository.commit(
        {
          ...record,
          savedAt: 150,
          projectJson: serializeProject({ ...createProject(), notes: 'supported saved latest' }),
        },
        1,
      );
      // Represent history left by a pre-fix downgrade: the latest snapshot is
      // compatible but the previous generation belongs to a newer build.
      const database = await openNativeDatabase();
      try {
        const transaction = database.transaction('snapshots', 'readwrite');
        const completed = transactionDone(transaction);
        const store = transaction.objectStore('snapshots');
        const request = store.get([storageKey, 1]);
        request.onsuccess = () => {
          const prior: unknown = request.result;
          store.put({ ...(prior as object), projectJson: futureProjectJson });
        };
        await completed;
      } finally {
        database.close();
      }
    }

    const service = new AutosaveDurableService({ repository, initialSessionId: sessionId });
    try {
      const original = await readOriginalBytes();
      const initialSession = await service.session();
      const initialLockHeld = !(await lockAvailable(sessionId));
      const read = await service.readLatest();
      const preservedAfterRead = (await readOriginalBytes()) === original;
      const write = await service.write({ ...createProject(), notes: 'current build work' }, 200);
      const rotatedSession = await service.session();
      const oldLockReleased = await lockAvailable(sessionId);
      const newLockHeld = !(await lockAvailable(rotatedSession.sessionId));
      const preservedAfterWrite = (await readOriginalBytes()) === original;
      const latest = await service.readLatest();
      const clear = await service.clearCurrent();
      const preservedAfterClear = (await readOriginalBytes()) === original;
      const clearedCurrentSlot = await repository.readSlot(
        autosaveStorageKeyForSession(rotatedSession.sessionId),
      );
      return {
        initialSession: {
          sessionId: initialSession.sessionId,
          ownership: initialSession.ownership,
        },
        initialLockHeld,
        readWarnings: read.warnings,
        readNotes: read.snapshot?.project.notes ?? null,
        preservedAfterRead,
        write,
        rotatedSession: {
          sessionId: rotatedSession.sessionId,
          ownership: rotatedSession.ownership,
        },
        oldLockReleased,
        newLockHeld,
        preservedAfterWrite,
        latestNotes: latest.snapshot?.project.notes ?? null,
        clear,
        preservedAfterClear,
        clearedCurrentSlot,
      };
    } finally {
      await service.stop();
    }

    function lockAvailable(id: string): Promise<boolean> {
      return navigator.locks.request(
        autosaveSessionLockName(id),
        { mode: 'exclusive', ifAvailable: true },
        (lock) => lock !== null,
      );
    }

    function openNativeDatabase(): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('Could not open native storage.'));
      });
    }

    function transactionDone(transaction: IDBTransaction): Promise<void> {
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Native storage failed.'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Native storage aborted.'));
      });
    }

    async function readOriginalBytes(): Promise<string | null> {
      if (kind === 'local') return localStorage.getItem(storageKey);
      const database = await openNativeDatabase();
      try {
        const transaction = database.transaction(['manifests', 'snapshots'], 'readonly');
        const completed = transactionDone(transaction);
        const manifest = transaction.objectStore('manifests').get(storageKey);
        const rows = transaction
          .objectStore('snapshots')
          .getAll(IDBKeyRange.bound([storageKey, 0], [storageKey, Number.MAX_SAFE_INTEGER]));
        await completed;
        return JSON.stringify({
          manifest: manifest.result as unknown,
          snapshots: rows.result as unknown,
        });
      } finally {
        database.close();
      }
    }
  }, storedCase);
}
