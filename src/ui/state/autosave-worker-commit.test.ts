// The interval autosave's commit runs in its worker (ADR-305 Amendment 1).
//
// These tests run the real worker module in this thread behind a stand-in
// Worker that structured-clones every message both ways, as the real boundary
// does, against one fake IndexedDB that the window's service and the worker's
// repository both open.

import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import {
  lastAutosaveHandOffMs,
  prepareAutosaveForWorkerCommit,
  type AutosaveHeldPreparation,
} from './autosave-preparation-client';
import { UnsupportedAutosaveVersionError } from './autosave-record';
import { AutosaveSessionLocks } from './autosave-session-lock';

const SESSION_ID = 'worker-commit-test';
const STORAGE_KEY = `lf2:autosave:v1:${SESSION_ID}`;

type WorkerScope = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};
const scope = globalThis as unknown as WorkerScope;
let workerMain: (event: MessageEvent) => void;

/** Runs the worker module's handler in this thread, one clone per crossing. */
class LoopbackWorker {
  static instances: LoopbackWorker[] = [];
  /** Everything the worker sent back to the window. */
  static replies: unknown[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  readonly received: unknown[] = [];

  constructor() {
    LoopbackWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.received.push(message);
    const delivered = structuredClone(message);
    queueMicrotask(() => {
      if (!this.terminated) workerMain({ data: delivered } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  static deliver(reply: unknown): void {
    const worker = [...LoopbackWorker.instances]
      .reverse()
      .find((candidate) => !candidate.terminated);
    const delivered = structuredClone(reply);
    LoopbackWorker.replies.push(delivered);
    queueMicrotask(() => worker?.onmessage?.({ data: delivered } as MessageEvent));
  }
}

function project(notes: string): Project {
  return { ...createProject(), notes };
}

function service(): AutosaveDurableService {
  const locks = new AutosaveSessionLocks(null);
  const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  vi.spyOn(locks, 'claim').mockResolvedValue({ kind: 'owned', guard: { release } });
  // No repository is passed: the default one is the database a worker can open.
  return new AutosaveDurableService({ locks, initialSessionId: SESSION_ID });
}

function laneIsFree(): boolean {
  let granted = false;
  reserveWorkerMemory((release) => {
    granted = true;
    release();
  })();
  return granted;
}

function repliesWithProjectText(): unknown[] {
  return LoopbackWorker.replies.filter((reply) => JSON.stringify(reply).includes('projectJson'));
}

// One module instance for the whole file, so the classes the worker checks
// with instanceof are the ones these tests import.
beforeAll(async () => {
  scope.onmessage = null;
  await import('./autosave-preparation-worker');
  if (scope.onmessage === null) throw new Error('The worker module did not install its handler.');
  workerMain = scope.onmessage;
  scope.onmessage = null;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  LoopbackWorker.instances = [];
  LoopbackWorker.replies = [];
  vi.stubGlobal('indexedDB', new FakeIDBFactory());
  vi.stubGlobal('Worker', LoopbackWorker);
  vi.spyOn(scope, 'postMessage').mockImplementation((reply: unknown) =>
    LoopbackWorker.deliver(reply),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('interval autosave committed by its worker', () => {
  it('writes the snapshot without the project text ever returning to the window', async () => {
    const autosave = service();

    await expect(autosave.write(project('first'), 100)).resolves.toMatchObject({
      kind: 'ok',
      backend: 'indexeddb',
      storageKey: STORAGE_KEY,
    });

    // The window sent the project and one commit; it got back two small replies.
    const [worker] = LoopbackWorker.instances;
    expect(worker?.received).toEqual([
      expect.objectContaining({ holdForCommit: true, storageKey: STORAGE_KEY }),
      { kind: 'commit', expectedEpoch: 0 },
    ]);
    expect(LoopbackWorker.replies).toEqual([
      { kind: 'held', storageKey: STORAGE_KEY },
      { kind: 'commit-result', result: { kind: 'committed', epoch: 1 } },
    ]);
    expect(repliesWithProjectText()).toEqual([]);
    expect(worker?.terminated).toBe(true);
    expect(laneIsFree()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect((await autosave.readLatest()).snapshot?.project.notes).toBe('first');
    await autosave.stop();
  });

  it('keeps the window and the worker on one epoch across writes and a clear', async () => {
    const autosave = service();
    await autosave.write(project('first'), 100);
    await autosave.write(project('second'), 200);

    // The compare-and-swap epoch the window passes is the one the worker left.
    expect(LoopbackWorker.instances.map((worker) => worker.received[1])).toEqual([
      { kind: 'commit', expectedEpoch: 0 },
      { kind: 'commit', expectedEpoch: 1 },
    ]);
    const slot = await new IndexedDbAutosaveRepository().readSlot(STORAGE_KEY);
    expect(slot).toMatchObject({ epoch: 2, current: { savedAt: 200 }, previous: { savedAt: 100 } });

    await expect(autosave.clearCurrent()).resolves.toEqual({ kind: 'ok' });
    await expect(autosave.write(project('third'), 300)).resolves.toMatchObject({ kind: 'ok' });
    expect((await autosave.readLatest()).snapshot?.project.notes).toBe('third');
    expect(LoopbackWorker.instances.every((worker) => worker.terminated)).toBe(true);
    await autosave.stop();
  });

  it('reports a write the slot has moved past as superseded', async () => {
    const autosave = service();
    await autosave.write(project('first'), 100);
    // Another writer advances the slot behind the service's remembered epoch.
    await new IndexedDbAutosaveRepository().commit(
      {
        schemaVersion: 1,
        savedAt: 150,
        sessionId: SESSION_ID,
        storageKey: STORAGE_KEY,
        projectJson: '{}',
      },
      1,
    );

    await expect(autosave.write(project('stale'), 200)).resolves.toEqual({ kind: 'superseded' });
    expect(LoopbackWorker.instances.every((worker) => worker.terminated)).toBe(true);
    expect(laneIsFree()).toBe(true);
    await autosave.stop();
  });

  it('takes the record back for the localStorage fallback when the commit fails', async () => {
    const autosave = service();
    vi.spyOn(IndexedDbAutosaveRepository.prototype, 'commit').mockRejectedValueOnce(
      new Error('IndexedDB write failed.'),
    );

    await expect(autosave.write(project('fallback'), 100)).resolves.toMatchObject({
      kind: 'ok',
      backend: 'local',
    });

    const [worker] = LoopbackWorker.instances;
    expect(worker?.received.slice(1)).toEqual([
      { kind: 'commit', expectedEpoch: 0 },
      { kind: 'take-record' },
    ]);
    // Only this path brings the project text to the window.
    expect(repliesWithProjectText()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ savedAt: 100 });
    expect(worker?.terminated).toBe(true);
    expect(laneIsFree()).toBe(true);
    await autosave.stop();
  });

  it('returns a refused project without holding anything', async () => {
    const autosave = service();
    const refused = {
      ...createProject(),
      scene: { ...createProject().scene, objects: [{ kind: 'not-a-real-object' }] },
    } as unknown as Project;

    await expect(autosave.write(refused, 100)).resolves.toMatchObject({
      kind: 'failed',
      reason: 'invalid-project',
    });
    expect(LoopbackWorker.instances[0]?.received).toHaveLength(1);
    expect(LoopbackWorker.instances[0]?.terminated).toBe(true);
    expect(laneIsFree()).toBe(true);
    await autosave.stop();
  });
});

describe('a record held by the autosave worker', () => {
  async function held(): Promise<AutosaveHeldPreparation> {
    const prepared = await prepareAutosaveForWorkerCommit(
      project('held'),
      100,
      SESSION_ID,
      STORAGE_KEY,
    );
    if (prepared.kind !== 'held') throw new Error(`Expected a held record, got ${prepared.kind}.`);
    return prepared;
  }

  it('measures the hand-off the window paid', async () => {
    const prepared = await held();
    expect(lastAutosaveHandOffMs()).toBeGreaterThanOrEqual(0);
    prepared.release();
  });

  it('keeps the worker and the memory lane until it is released, once', async () => {
    const prepared = await held();
    const [worker] = LoopbackWorker.instances;
    expect(worker?.terminated).toBe(false);
    expect(laneIsFree()).toBe(false);

    prepared.release();
    prepared.release();
    expect(worker?.terminated).toBe(true);
    expect(laneIsFree()).toBe(true);
    await expect(prepared.commit(0)).rejects.toThrow('no longer running');
  });

  it('rebuilds the version refusal the caller tells apart, and keeps the record', async () => {
    vi.spyOn(IndexedDbAutosaveRepository.prototype, 'commit').mockRejectedValueOnce(
      new UnsupportedAutosaveVersionError(),
    );
    const prepared = await held();

    await expect(prepared.commit(0)).rejects.toBeInstanceOf(UnsupportedAutosaveVersionError);
    // The failed commit left the worker alive with the record.
    expect(LoopbackWorker.instances[0]?.terminated).toBe(false);
    await expect(prepared.takeRecord()).resolves.toMatchObject({
      savedAt: 100,
      sessionId: SESSION_ID,
    });
    expect(LoopbackWorker.instances[0]?.terminated).toBe(true);
    expect(laneIsFree()).toBe(true);
  });

  it('gives up on a worker that never answers the commit', async () => {
    const prepared = await held();
    const [worker] = LoopbackWorker.instances;
    vi.useFakeTimers();
    // The commit question is lost: the worker stays silent.
    vi.spyOn(worker!, 'postMessage').mockImplementation(() => undefined);

    const committing = prepared.commit(0);
    const outcome = expect(committing).rejects.toThrow('did not answer within 60 seconds');
    await vi.advanceTimersByTimeAsync(60_000);
    await outcome;
    expect(worker?.terminated).toBe(true);
    expect(laneIsFree()).toBe(true);
  });
});
