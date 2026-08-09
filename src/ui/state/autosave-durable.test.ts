import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { readAutosave, writeAutosave } from './autosave';
import { AutosaveDurableService, type AutosaveDurableRepository } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { AUTOSAVE_SCHEMA_VERSION } from './autosave-record';
import { AutosaveSessionLocks } from './autosave-session-lock';

describe('AutosaveDurableService', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('uses atomic IndexedDB as the normal interval backend', async () => {
    const service = testService();
    const localLengthBeforeWrite = localStorage.length;

    const written = await service.write(project('recover me'), 100);
    expect(written).toMatchObject({
      kind: 'ok',
      backend: 'indexeddb',
    });

    expect(localStorage.length).toBe(localLengthBeforeWrite);
    const read = await service.readLatest();
    expect(read.snapshot?.project.notes).toBe('recover me');
    expect(read.snapshot?.backend).toBe('indexeddb');
    await service.stop();
  });

  it('falls back to the synchronous local slot when IndexedDB is unavailable', async () => {
    const service = testService({
      repository: new IndexedDbAutosaveRepository({ factory: undefined }),
    });

    await expect(service.write(project('local fallback'), 100)).resolves.toMatchObject({
      kind: 'ok',
      backend: 'local',
    });
    expect(readAutosave()?.project.notes).toBe('local fallback');
    expect((await service.readLatest()).snapshot?.project.notes).toBe('local fallback');
    await service.stop();
  });

  it('reports failure only when both durable backends fail', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage full', 'QuotaExceededError');
    });
    const service = testService({
      repository: new IndexedDbAutosaveRepository({ factory: undefined }),
    });

    await expect(service.write(project('too large'), 100)).resolves.toMatchObject({
      kind: 'failed',
      reason: 'quota',
    });
    await service.stop();
  });

  it('serializes a clear behind an in-flight write so stale data cannot return', async () => {
    const base = testRepository();
    const deferred = new DeferredCommitRepository(base);
    const service = testService({ repository: deferred });
    const writing = service.write(project('stale'), 100);
    await deferred.started;

    const clearing = service.clearCurrent();
    deferred.release();

    await expect(writing).resolves.toMatchObject({ kind: 'ok' });
    await expect(clearing).resolves.toMatchObject({ kind: 'ok' });
    expect((await service.readLatest()).snapshot).toBeNull();
    await service.stop();
  });

  it('clears a local fallback created by an earlier queued IndexedDB failure', async () => {
    sessionStorage.setItem('lf2:autosave:session-id:v1', 'window-a');
    const repository = new RejectingCommitRepository(testRepository());
    const service = testService({
      repository,
      locks: new AutosaveSessionLocks(new TestLockManager().asLockManager()),
      initialSessionId: 'window-a',
    });
    const writing = service.write(project('fallback during save'), 100);
    await repository.started;

    const clearing = service.clearCurrent();
    repository.release();

    await expect(writing).resolves.toMatchObject({ kind: 'ok', backend: 'local' });
    await expect(clearing).resolves.toEqual({ kind: 'ok' });
    expect(localStorage.getItem('lf2:autosave:v1:window-a')).toBeNull();
    await service.stop();
  });

  it('reports a failed local deletion even when the IndexedDB clear commits', async () => {
    sessionStorage.setItem('lf2:autosave:session-id:v1', 'window-a');
    expect(writeAutosave(project('stale local'), 100, { sessionId: 'window-a' }).kind).toBe('ok');
    const storageKey = 'lf2:autosave:v1:window-a';
    const service = testService({
      locks: new AutosaveSessionLocks(new TestLockManager().asLockManager()),
      initialSessionId: 'window-a',
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError');
    });

    await expect(service.clearCurrent()).resolves.toMatchObject({ kind: 'failed' });
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    await service.stop();
  });

  it('recovers the previous generation when the current project JSON is invalid', async () => {
    const repository = testRepository();
    const service = testService({ repository });
    await service.write(project('previous'), 100);
    const session = await service.session();
    const storageKey = `lf2:autosave:v1:${encodeURIComponent(session.sessionId)}`;
    await repository.commit(
      {
        schemaVersion: AUTOSAVE_SCHEMA_VERSION,
        sessionId: session.sessionId,
        storageKey,
        savedAt: 200,
        projectJson: '{"not":"a project"}',
      },
      1,
    );

    const read = await service.readLatest();
    expect(read.snapshot?.project.notes).toBe('previous');
    expect(read.warnings).toContain('recovered-previous');
    await service.stop();
  });

  it('does not surface a live foreign window as abandoned recovery', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const locks = new AutosaveSessionLocks(new TestLockManager().asLockManager());
    const first = testService({
      repository: new IndexedDbAutosaveRepository({ factory, databaseName }),
      locks,
      initialSessionId: 'window-a',
    });
    const second = testService({
      repository: new IndexedDbAutosaveRepository({ factory, databaseName }),
      locks,
      initialSessionId: 'window-b',
    });
    await first.write(project('live foreign project'), 100);

    expect((await second.readLatest()).snapshot).toBeNull();
    await first.stop();
    expect((await second.readLatest()).snapshot?.project.notes).toBe('live foreign project');
    await second.stop();
  });

  it('clears an abandoned foreign snapshot only after a fresh ownership probe', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const locks = new AutosaveSessionLocks(new TestLockManager().asLockManager());
    const first = testService({
      repository: new IndexedDbAutosaveRepository({ factory, databaseName }),
      locks,
      initialSessionId: 'window-a',
    });
    await first.write(project('abandoned project'), 100);
    await first.stop();
    const second = testService({
      repository: new IndexedDbAutosaveRepository({ factory, databaseName }),
      locks,
      initialSessionId: 'window-b',
    });

    const recovered = (await second.readLatest()).snapshot;
    expect(recovered).toMatchObject({
      ownership: 'abandoned',
      sessionId: 'window-a',
    });
    await expect(second.clearRecovered(recovered!)).resolves.toEqual({ kind: 'ok' });
    expect((await second.readLatest()).snapshot).toBeNull();
    await second.stop();
  });

  it('retains a foreign snapshot if its owner becomes live before cleanup', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const locks = new AutosaveSessionLocks(new TestLockManager().asLockManager());
    const repository = () => new IndexedDbAutosaveRepository({ factory, databaseName });
    const first = testService({ repository: repository(), locks, initialSessionId: 'window-a' });
    await first.write(project('reactivated project'), 100);
    await first.stop();
    const second = testService({ repository: repository(), locks, initialSessionId: 'window-b' });
    const recovered = (await second.readLatest()).snapshot;
    expect(recovered?.ownership).toBe('abandoned');
    const reactivated = testService({
      repository: repository(),
      locks,
      initialSessionId: 'window-a',
    });
    await reactivated.session();

    await expect(second.clearRecovered(recovered!)).resolves.toEqual({
      kind: 'retained',
      reason: 'live',
    });
    await reactivated.stop();
    expect((await second.readLatest()).snapshot?.project.notes).toBe('reactivated project');
    await second.stop();
  });

  it('retains foreign recovery data when Web Locks cannot prove abandonment', async () => {
    const factory = new FakeIDBFactory();
    const databaseName = `curvedesk-autosave-test-${crypto.randomUUID()}`;
    const repository = () => new IndexedDbAutosaveRepository({ factory, databaseName });
    const writer = testService({
      repository: repository(),
      locks: new AutosaveSessionLocks(null),
      initialSessionId: 'writer-hint',
    });
    await writer.write(project('ownership unknown'), 100);
    await writer.stop();
    const reader = testService({
      repository: repository(),
      locks: new AutosaveSessionLocks(null),
      initialSessionId: 'reader-hint',
    });

    const recovered = (await reader.readLatest()).snapshot;
    expect(recovered?.ownership).toBe('unknown');
    await expect(reader.clearRecovered(recovered!)).resolves.toEqual({
      kind: 'retained',
      reason: 'unsupported',
    });
    expect((await reader.readLatest()).snapshot?.project.notes).toBe('ownership unknown');
    await reader.stop();
  });
});

function project(notes: string): Project {
  return { ...createProject(), notes };
}

function testRepository(): IndexedDbAutosaveRepository {
  return new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `curvedesk-autosave-test-${crypto.randomUUID()}`,
  });
}

type TestServiceOptions = {
  readonly repository?: AutosaveDurableRepository;
  readonly locks?: AutosaveSessionLocks;
  readonly initialSessionId?: string;
};

function testService(options: TestServiceOptions = {}): AutosaveDurableService {
  return new AutosaveDurableService({
    repository: options.repository ?? testRepository(),
    locks: options.locks ?? new AutosaveSessionLocks(null),
    initialSessionId: options.initialSessionId ?? `test-${crypto.randomUUID()}`,
    rotateSessionId: () => `rotated-${crypto.randomUUID()}`,
  });
}

class DeferredCommitRepository implements AutosaveDurableRepository {
  readonly started: Promise<void>;
  private finishStart = (): void => undefined;
  private finishCommit = (): void => undefined;
  private readonly gate: Promise<void>;

  constructor(private readonly delegate: AutosaveDurableRepository) {
    this.started = new Promise((resolve) => {
      this.finishStart = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.finishCommit = resolve;
    });
  }

  release(): void {
    this.finishCommit();
  }

  async commit(...args: Parameters<AutosaveDurableRepository['commit']>) {
    this.finishStart();
    await this.gate;
    return this.delegate.commit(...args);
  }

  clear(...args: Parameters<AutosaveDurableRepository['clear']>) {
    return this.delegate.clear(...args);
  }

  readEpoch(...args: Parameters<AutosaveDurableRepository['readEpoch']>) {
    return this.delegate.readEpoch(...args);
  }

  readAllSlots(...args: Parameters<AutosaveDurableRepository['readAllSlots']>) {
    return this.delegate.readAllSlots(...args);
  }
}

class RejectingCommitRepository implements AutosaveDurableRepository {
  readonly started: Promise<void>;
  private finishStart = (): void => undefined;
  private finishCommit = (): void => undefined;
  private readonly gate: Promise<void>;

  constructor(private readonly delegate: AutosaveDurableRepository) {
    this.started = new Promise((resolve) => {
      this.finishStart = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.finishCommit = resolve;
    });
  }

  release(): void {
    this.finishCommit();
  }

  async commit(): Promise<never> {
    this.finishStart();
    await this.gate;
    throw new Error('IndexedDB commit failed.');
  }

  clear(...args: Parameters<AutosaveDurableRepository['clear']>) {
    return this.delegate.clear(...args);
  }

  readEpoch(...args: Parameters<AutosaveDurableRepository['readEpoch']>) {
    return this.delegate.readEpoch(...args);
  }

  readAllSlots(...args: Parameters<AutosaveDurableRepository['readAllSlots']>) {
    return this.delegate.readAllSlots(...args);
  }
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
