import type { Project } from '../../core/scene';
import { clearAutosave } from './autosave';
import type { AutosaveWriteFailure } from './autosave-record';
import { prepareAutosaveRecord, type AutosaveWriteResult } from './autosave-record';
import {
  autosaveStorageKeyForSession,
  currentAutosaveSessionId,
  replaceAutosaveSessionId,
  type LocalAutosaveClearResult,
  writePreparedLocalAutosave,
} from './autosave-local-storage';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import {
  readLatestDurableAutosave,
  type AutosaveDurableReadResult,
  type AutosaveDurableSnapshot,
} from './autosave-durable-read';
import type { AutosaveDurableRepository } from './autosave-durable-repository';
import { AutosaveSessionLocks, type AutosaveSessionGuard } from './autosave-session-lock';

export type { AutosaveDurableRepository } from './autosave-durable-repository';
export type {
  AutosaveDurableReadResult,
  AutosaveDurableSnapshot,
  AutosaveDurableWarning,
} from './autosave-durable-read';

export type AutosaveDurableWriteResult =
  | {
      readonly kind: 'ok';
      readonly savedAt: number;
      readonly storageKey: string;
      readonly backend: 'indexeddb' | 'local';
    }
  | { readonly kind: 'superseded' }
  | AutosaveWriteFailure;

export type AutosaveDurableClearResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'retained'; readonly reason: 'live' | 'unsupported' }
  | { readonly kind: 'failed'; readonly error: unknown };

type AutosaveOwnedSession = {
  readonly sessionId: string;
  readonly guard?: AutosaveSessionGuard;
  readonly ownership: 'owned' | 'degraded';
};

type AutosaveDurableOptions = {
  readonly repository?: AutosaveDurableRepository;
  readonly locks?: AutosaveSessionLocks;
  readonly initialSessionId?: string;
  readonly rotateSessionId?: () => string;
};

export class AutosaveDurableService {
  private readonly repository: AutosaveDurableRepository;
  private readonly locks: AutosaveSessionLocks;
  private readonly rotateSessionId: () => string;
  private readonly epochs = new Map<string, number>();
  private sessionIdHint: string;
  private sessionPromise: Promise<AutosaveOwnedSession> | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: AutosaveDurableOptions = {}) {
    this.repository = options.repository ?? new IndexedDbAutosaveRepository();
    this.locks = options.locks ?? new AutosaveSessionLocks();
    this.sessionIdHint = options.initialSessionId ?? currentAutosaveSessionId();
    this.rotateSessionId = options.rotateSessionId ?? replaceAutosaveSessionId;
  }

  session(): Promise<AutosaveOwnedSession> {
    this.sessionPromise ??= this.claimSession();
    return this.sessionPromise;
  }

  write(project: Project, savedAt: number = Date.now()): Promise<AutosaveDurableWriteResult> {
    return this.enqueue(async () => this.writeNow(project, savedAt));
  }

  clearCurrent(): Promise<AutosaveDurableClearResult> {
    const invalidatedSessionId = this.sessionIdHint;
    const localClears = [clearAutosave()];
    return this.enqueue(async () => {
      const session = await this.session();
      // Repeat inside the queue: an earlier IndexedDB write can fail after the
      // immediate clear and recreate this slot through the local fallback.
      localClears.push(clearAutosave({ sessionId: session.sessionId }));
      if (session.sessionId !== invalidatedSessionId) {
        localClears.push(clearAutosave({ sessionId: invalidatedSessionId }));
      }
      return combineClearResults(await this.clearNow(session.sessionId), localClears);
    });
  }

  async clearRecovered(
    snapshot: AutosaveDurableSnapshot,
    retainedStorageKey?: string,
  ): Promise<AutosaveDurableClearResult> {
    if (snapshot.storageKey === retainedStorageKey) return { kind: 'ok' };
    const session = await this.session();
    if (snapshot.sessionId === undefined || snapshot.sessionId === session.sessionId) {
      return this.enqueue(async () => this.clearSnapshotNow(snapshot));
    }
    const result = await this.locks.runIfAbandoned(snapshot.sessionId, async () =>
      this.enqueue(async () => this.clearSnapshotNow(snapshot)),
    );
    if (result.kind === 'reconciled') return result.value;
    if (result.kind === 'failed') return { kind: 'failed', error: result.error };
    return { kind: 'retained', reason: result.kind };
  }

  async readLatest(): Promise<AutosaveDurableReadResult> {
    await this.tail;
    const session = await this.session();
    return readLatestDurableAutosave(this.repository, this.locks, session.sessionId);
  }

  async stop(): Promise<void> {
    await this.tail;
    if (this.sessionPromise === null) return;
    const session = await this.sessionPromise;
    await session.guard?.release();
  }

  private async writeNow(project: Project, savedAt: number): Promise<AutosaveDurableWriteResult> {
    const session = await this.session();
    const storageKey = autosaveStorageKeyForSession(session.sessionId);
    const prepared = prepareAutosaveRecord(project, savedAt, session.sessionId, storageKey);
    if (prepared.kind !== 'ok') return prepared;
    try {
      const epoch = await this.epoch(storageKey);
      const result = await this.repository.commit(
        { ...prepared.record, sessionId: session.sessionId, storageKey },
        epoch,
      );
      if (result.kind === 'conflict') {
        this.epochs.set(storageKey, result.actualEpoch);
        return { kind: 'superseded' };
      }
      this.epochs.set(storageKey, result.epoch);
      return { kind: 'ok', savedAt, storageKey, backend: 'indexeddb' };
    } catch (indexedDbError) {
      return localFallback(prepared.record, storageKey, indexedDbError);
    }
  }

  private async clearNow(sessionId: string): Promise<AutosaveDurableClearResult> {
    const storageKey = autosaveStorageKeyForSession(sessionId);
    try {
      const epoch = await this.epoch(storageKey);
      const result = await this.repository.clear({ storageKey, sessionId, expectedEpoch: epoch });
      if (result.kind === 'conflict') {
        this.epochs.set(storageKey, result.actualEpoch);
        return { kind: 'conflict' };
      }
      this.epochs.set(storageKey, result.epoch);
      return { kind: 'ok' };
    } catch (error) {
      return { kind: 'failed', error };
    }
  }

  private async clearSnapshotNow(
    snapshot: AutosaveDurableSnapshot,
  ): Promise<AutosaveDurableClearResult> {
    const local = clearAutosave(snapshot);
    if (snapshot.sessionId === undefined) return localClearResult(local);
    try {
      const expectedEpoch =
        snapshot.epoch ?? (await this.repository.readEpoch(snapshot.storageKey));
      const result = await this.repository.clear({
        storageKey: snapshot.storageKey,
        sessionId: snapshot.sessionId,
        expectedEpoch,
      });
      if (result.kind === 'conflict') return { kind: 'conflict' };
      this.epochs.set(snapshot.storageKey, result.epoch);
      return combineClearResults({ kind: 'ok' }, [local]);
    } catch (error) {
      return { kind: 'failed', error };
    }
  }

  private async epoch(storageKey: string): Promise<number> {
    const known = this.epochs.get(storageKey);
    if (known !== undefined) return known;
    const stored = await this.repository.readEpoch(storageKey);
    this.epochs.set(storageKey, stored);
    return stored;
  }

  private async claimSession(): Promise<AutosaveOwnedSession> {
    let sessionId = this.sessionIdHint;
    for (;;) {
      const claim = await this.locks.claim(sessionId);
      if (claim.kind === 'owned') return { sessionId, ownership: 'owned', guard: claim.guard };
      if (claim.kind !== 'contended') {
        sessionId = this.rotateSessionId();
        this.sessionIdHint = sessionId;
        return { sessionId, ownership: 'degraded' };
      }
      sessionId = this.rotateSessionId();
      this.sessionIdHint = sessionId;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function combineClearResults(
  durable: AutosaveDurableClearResult,
  localResults: readonly LocalAutosaveClearResult[],
): AutosaveDurableClearResult {
  if (durable.kind !== 'ok') return durable;
  const localErrors = localResults.flatMap((result) => {
    if (result.kind === 'ok') return [];
    return [
      result.kind === 'failed' ? result.error : new Error('Local autosave cleanup is unavailable.'),
    ];
  });
  if (localErrors.length === 0) return durable;
  return {
    kind: 'failed',
    error:
      localErrors.length === 1
        ? localErrors[0]
        : new AggregateError(localErrors, 'Autosave local cleanup was incomplete.'),
  };
}

function localClearResult(result: LocalAutosaveClearResult): AutosaveDurableClearResult {
  return combineClearResults({ kind: 'ok' }, [result]);
}

function localFallback(
  record: Parameters<typeof writePreparedLocalAutosave>[0],
  storageKey: string,
  indexedDbError: unknown,
): AutosaveDurableWriteResult {
  const local: AutosaveWriteResult = writePreparedLocalAutosave(record, storageKey);
  if (local.kind === 'ok') return { ...local, backend: 'local' };
  if (local.kind === 'unavailable') return local;
  return {
    ...local,
    error: new AggregateError([indexedDbError, local.error], 'Both autosave backends failed.'),
  };
}

export const projectAutosaveService = new AutosaveDurableService();
