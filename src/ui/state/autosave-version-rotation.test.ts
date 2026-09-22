import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { serializeProject } from '../../io/project/serialize-project';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { AutosaveSessionLocks } from './autosave-session-lock';
import {
  autosaveStorageKeyForSession,
  currentAutosaveSessionId,
  writeLocalAutosave,
} from './autosave-local-storage';

const OLD_SESSION = 'before-rotation';
const NEW_SESSION = 'after-rotation';
const OLD_KEY = autosaveStorageKeyForSession(OLD_SESSION);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it.each(['current', 'recovered'] as const)(
  'does not clear a reclaimed old session after rotating while %s cleanup waits',
  async (cleanup) => {
    const { repository, locks, service } = await fixture();
    writeLocalAutosave({ ...createProject(), notes: 'prior compatible backup' }, 0);
    const recovered = (await service.readLatest()).snapshot;
    if (recovered === null) throw new Error('Expected the compatible local backup.');
    const first = deferred();
    const firstGate = deferred();
    const rotated = deferred();
    const rotatedGate = deferred();
    const commit = repository.commit.bind(repository);
    vi.spyOn(repository, 'commit')
      .mockImplementationOnce(async (...args) => {
        first.resolve();
        await firstGate.promise;
        return commit(...args);
      })
      .mockImplementationOnce(async (...args) => {
        rotated.resolve();
        await rotatedGate.promise;
        return commit(...args);
      });
    let foreignGuard: Awaited<ReturnType<AutosaveSessionLocks['claim']>> | undefined;
    try {
      const writing = service.write({ ...createProject(), notes: 'saved document' }, 2);
      await first.promise;
      const clearing =
        cleanup === 'current' ? service.clearCurrent() : service.clearRecovered(recovered);
      firstGate.resolve();
      await rotated.promise;
      foreignGuard = await locks.claim(OLD_SESSION);
      expect(foreignGuard.kind).toBe('owned');
      // The reopened window can write its unload fallback before its interval.
      expect(
        writeLocalAutosave({ ...createProject(), notes: 'other window unsaved work' }, 3, {
          sessionId: OLD_SESSION,
        }).kind,
      ).toBe('ok');
      const foreignBytes = localStorage.getItem(OLD_KEY);
      rotatedGate.resolve();
      expect((await writing).kind).toBe('ok');
      const cleared = await clearing;
      expect(localStorage.getItem(OLD_KEY)).toBe(foreignBytes);
      if (cleanup === 'current') {
        expect(cleared.kind).toBe('ok');
        expect(await repository.readSlot(autosaveStorageKeyForSession(NEW_SESSION))).toMatchObject({
          current: null,
          previous: null,
        });
      } else {
        expect(cleared).toEqual({ kind: 'retained', reason: 'live' });
      }
    } finally {
      firstGate.resolve();
      rotatedGate.resolve();
      if (foreignGuard?.kind === 'owned') await foreignGuard.guard.release();
      await service.stop();
    }
  },
);

it('rechecks ownership before retiring a slot scanned before rotation', async () => {
  const { repository, locks, service } = await fixture();
  localStorage.setItem(OLD_KEY, '{incomplete');
  const ready = deferred();
  const gate = deferred();
  const readAllSlots = repository.readAllSlots.bind(repository);
  vi.spyOn(repository, 'readAllSlots').mockImplementationOnce(async () => {
    const slots = await readAllSlots();
    ready.resolve();
    await gate.promise;
    return slots;
  });
  let foreignGuard: Awaited<ReturnType<AutosaveSessionLocks['claim']>> | undefined;
  try {
    const recovery = service.readLatest();
    await ready.promise;
    expect((await service.write(createProject())).kind).toBe('ok');
    foreignGuard = await locks.claim(OLD_SESSION);
    expect(foreignGuard.kind).toBe('owned');
    gate.resolve();
    await recovery;
    expect(localStorage.getItem(OLD_KEY)).toBe('{incomplete');
  } finally {
    gate.resolve();
    if (foreignGuard?.kind === 'owned') await foreignGuard.guard.release();
    await service.stop();
  }
});

it('publishes the new session before releasing the old guard to synchronous writers', async () => {
  const { locks, service } = await fixture();
  const releasing = deferred();
  const gate = deferred();
  const claim = locks.claim.bind(locks);
  vi.spyOn(locks, 'claim').mockImplementationOnce(async (sessionId) => {
    const owned = await claim(sessionId);
    if (owned.kind !== 'owned') throw new Error('Expected an owned initial session.');
    return {
      ...owned,
      guard: {
        release: async () => {
          await owned.guard.release();
          releasing.resolve();
          await gate.promise;
        },
      },
    };
  });
  try {
    const writing = service.write(createProject());
    await releasing.promise;
    expect(currentAutosaveSessionId()).toBe(NEW_SESSION);
    expect(await locks.claim(NEW_SESSION)).toEqual({ kind: 'contended' });
    const written = writeLocalAutosave(createProject());
    expect(written).toMatchObject({
      kind: 'ok',
      storageKey: autosaveStorageKeyForSession(NEW_SESSION),
    });
    gate.resolve();
    expect((await writing).kind).toBe('ok');
  } finally {
    gate.resolve();
    await service.stop();
  }
});

async function fixture() {
  sessionStorage.setItem('lf2:autosave:session-id:v1', OLD_SESSION);
  const repository = new IndexedDbAutosaveRepository({
    factory: new IDBFactory(),
    databaseName: `rotation-owner-${crypto.randomUUID()}`,
  });
  const project: unknown = JSON.parse(serializeProject(createProject()));
  await repository.commit(
    {
      schemaVersion: 1,
      sessionId: OLD_SESSION,
      storageKey: OLD_KEY,
      savedAt: 1,
      projectJson: JSON.stringify({
        ...(project as object),
        schemaVersion: PROJECT_SCHEMA_VERSION + 1,
      }),
    },
    0,
  );
  const locks = new AutosaveSessionLocks(lockManager());
  const service = new AutosaveDurableService({
    repository,
    locks,
    initialSessionId: OLD_SESSION,
    rotateSessionId: () => {
      sessionStorage.setItem('lf2:autosave:session-id:v1', NEW_SESSION);
      return NEW_SESSION;
    },
  });
  return { repository, locks, service };
}

function lockManager(): LockManager {
  const held = new Set<string>();
  return {
    request: async (
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => Promise<unknown>,
    ) => {
      if (options.ifAvailable && held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name, mode: 'exclusive' } as Lock);
      } finally {
        held.delete(name);
      }
    },
  } as unknown as LockManager;
}

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
