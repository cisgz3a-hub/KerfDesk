// A stale autosave that this build cannot turn back into a project used to
// re-announce itself forever: every launch rescanned it, classified it as a
// corrupt slot, and pushed the "recovery storage could not be fully read"
// warning — with nothing to recover and nothing the user could do about it.
// Retirement makes the warning a one-time event and frees the localStorage
// quota the working autosave needs.

import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { autosaveStorageKeyForSession } from './autosave-local-storage';
import { AUTOSAVE_SCHEMA_VERSION } from './autosave-record';
import { AutosaveSessionLocks, autosaveSessionLockName } from './autosave-session-lock';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('unreadable autosave retirement', () => {
  it('warns once about a record an older build wrote, then stops', async () => {
    const staleKey = autosaveStorageKeyForSession('stale-window');
    localStorage.setItem(staleKey, olderBuildRecord());
    const service = testService();

    const first = await service.readLatest();
    expect(first.snapshot).toBeNull();
    expect(first.warnings).toContain('corrupt-slot');
    expect(first.unreadable).toEqual([
      {
        storageKey: staleKey,
        sessionId: 'stale-window',
        backend: 'local',
        raw: olderBuildRecord(),
      },
    ]);

    expect(localStorage.getItem(staleKey)).toBeNull();
    const second = await service.readLatest();
    expect(second.warnings).toEqual([]);
    expect(second.unreadable).toEqual([]);
  });

  it('retires a record whose project payload no longer deserializes', async () => {
    const staleKey = autosaveStorageKeyForSession('stale-window');
    localStorage.setItem(
      staleKey,
      JSON.stringify({
        schemaVersion: AUTOSAVE_SCHEMA_VERSION,
        savedAt: 100,
        projectJson: '{"notAProject":true}',
        sessionId: 'stale-window',
      }),
    );

    const read = await testService().readLatest();

    expect(read.warnings).toContain('corrupt-slot');
    expect(localStorage.getItem(staleKey)).toBeNull();
  });

  // M15: a live window's slot is a real backup even when this build cannot read
  // what is currently in it — that window may be running a build that can, and
  // its beforeunload write still lands there. Retirement never races a window
  // that is still running.
  it('retains an unreadable slot that a live window still owns', async () => {
    const liveKey = autosaveStorageKeyForSession('live-window');
    localStorage.setItem(liveKey, olderBuildRecord('live-window'));

    const read = await testService({ liveSessionIds: ['live-window'] }).readLatest();

    expect(read.warnings).toContain('corrupt-slot');
    expect(localStorage.getItem(liveKey)).not.toBeNull();
  });

  // Without Web Locks the app cannot tell a dead window from a live one, so it
  // keeps the existing conservative policy and leaves the slot alone.
  it('retains an unreadable slot when session locks are unsupported', async () => {
    const staleKey = autosaveStorageKeyForSession('stale-window');
    localStorage.setItem(staleKey, olderBuildRecord());

    const read = await testService({ locks: new AutosaveSessionLocks(null) }).readLatest();

    expect(read.warnings).toContain('corrupt-slot');
    expect(localStorage.getItem(staleKey)).not.toBeNull();
  });

  it('leaves a readable autosave in place', async () => {
    const service = testService();
    await service.write(project('still recoverable'), 100);

    const read = await service.readLatest();

    expect(read.snapshot?.project.notes).toBe('still recoverable');
    expect(read.unreadable).toEqual([]);
    expect(read.warnings).toEqual([]);
  });

  it('retires an IndexedDB manifest whose snapshot no longer resolves', async () => {
    const repository = testRepository();
    const service = testService({ repository, initialSessionId: 'owner-window' });
    await service.write(project('durable write'), 100);
    const storageKey = autosaveStorageKeyForSession('owner-window');
    await stripSnapshotRows(repository);

    const read = await service.readLatest();

    expect(read.snapshot).toBeNull();
    expect(read.warnings).toContain('corrupt-slot');
    expect(read.unreadable).toEqual([
      { storageKey, sessionId: 'owner-window', backend: 'indexeddb', epoch: 1 },
    ]);
    expect((await service.readLatest()).warnings).toEqual([]);
  });
});

function olderBuildRecord(sessionId = 'stale-window'): string {
  return JSON.stringify({
    schemaVersion: AUTOSAVE_SCHEMA_VERSION - 1,
    savedAt: 100,
    projectJson: '{"shape":"from an older build"}',
    sessionId,
  });
}

function project(notes: string): Project {
  return { ...createProject(), notes };
}

// Deletes the snapshot rows while leaving the manifests that point at them —
// the shape a slot takes when a browser evicts part of an origin's storage.
async function stripSnapshotRows(repository: IndexedDbAutosaveRepository): Promise<void> {
  const openDatabase = repository as unknown as { database(): Promise<IDBDatabase> };
  const database = await openDatabase.database();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('snapshots', 'readwrite');
    transaction.objectStore('snapshots').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Snapshot clear failed.'));
  });
}

// Grants every session lock except the ones a named "live" window holds, which
// it refuses for `ifAvailable` requests exactly as a real held lock would.
function stubLockManager(liveSessionIds: ReadonlyArray<string>): LockManager {
  const liveNames = new Set(liveSessionIds.map(autosaveSessionLockName));
  return {
    request: async (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) =>
      callback(
        liveNames.has(name) && options.ifAvailable === true
          ? null
          : ({ name, mode: 'exclusive' } as Lock),
      ),
  } as unknown as LockManager;
}

function testRepository(): IndexedDbAutosaveRepository {
  return new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `curvedesk-autosave-retirement-${crypto.randomUUID()}`,
  });
}

type TestServiceOptions = {
  readonly repository?: IndexedDbAutosaveRepository;
  readonly locks?: AutosaveSessionLocks;
  readonly liveSessionIds?: ReadonlyArray<string>;
  readonly initialSessionId?: string;
};

function testService(options: TestServiceOptions = {}): AutosaveDurableService {
  return new AutosaveDurableService({
    repository: options.repository ?? testRepository(),
    locks: options.locks ?? new AutosaveSessionLocks(stubLockManager(options.liveSessionIds ?? [])),
    initialSessionId: options.initialSessionId ?? `test-${crypto.randomUUID()}`,
    rotateSessionId: () => `rotated-${crypto.randomUUID()}`,
  });
}
