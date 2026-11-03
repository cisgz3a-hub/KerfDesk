import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { reserveWorkerMemory } from '../worker-memory-lane';
import {
  AutosavePreparationTimeoutError,
  prepareAutosaveRecordOffThread,
  type AutosavePreparationRequest,
} from './autosave-preparation-client';
import { startAutosaveLoop } from './autosave-loop';
import * as records from './autosave-record';
import type { AutosavePreparation } from './autosave-record';

const SESSION_ID = 'autosave-worker-test';
const STORAGE_KEY = `lf2:autosave:v1:${SESSION_ID}`;

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<AutosavePreparation>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly postMessage = vi.fn<(_request: AutosavePreparationRequest) => void>();
  readonly terminate = vi.fn<() => void>();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  respond(result: AutosavePreparation): void {
    this.onmessage?.({ data: result } as MessageEvent<AutosavePreparation>);
  }
}

describe('off-thread autosave preparation', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retires a silent worker after one minute and releases waiting work', async () => {
    vi.useFakeTimers();
    const preparing = prepareAutosaveRecordOffThread(createProject(), 123, SESSION_ID, STORAGE_KEY);
    const worker = FakeWorker.instances[0]!;
    const lateReply = worker.onmessage!;
    let nextStarted = false;
    const cancelNext = reserveWorkerMemory((release) => {
      nextStarted = true;
      release();
    });
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expectReleased(worker);
      expect(nextStarted).toBe(true);
      await expect(preparing).resolves.toMatchObject({
        kind: 'failed',
        reason: 'storage-error',
        error: expect.any(AutosavePreparationTimeoutError),
      });
      lateReply({
        data: records.prepareAutosaveRecord(createProject(), 123, SESSION_ID, STORAGE_KEY),
      } as MessageEvent<AutosavePreparation>);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      worker.respond({ kind: 'failed', reason: 'storage-error', error: new Error('test cleanup') });
      cancelNext();
    }
  });

  it('keeps a healthy active autosave non-preemptible before starting interactive work', async () => {
    const project = createProject();
    const expected = records.prepareAutosaveRecord(project, 123, SESSION_ID, STORAGE_KEY);
    const preparing = prepareAutosaveRecordOffThread(project, 123, SESSION_ID, STORAGE_KEY);
    const worker = FakeWorker.instances[0]!;
    let startedAfterTermination = false;
    const cancelNext = reserveWorkerMemory(
      (release) => {
        startedAfterTermination = worker.terminate.mock.calls.length === 1;
        release();
      },
      { priority: 'interactive' },
    );
    try {
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(startedAfterTermination).toBe(false);
      worker.respond(expected);
      expectReleased(worker);
      expect(startedAfterTermination).toBe(true);
      await expect(preparing).resolves.toEqual(expected);
      expectLaneReleased();
    } finally {
      worker.respond({ kind: 'failed', reason: 'storage-error', error: new Error('test cleanup') });
      cancelNext();
    }
  });

  it('expires a queued autosave without starting a worker or retiring another owner', async () => {
    vi.useFakeTimers();
    const releaseOwner = reserveWorkerMemory(() => undefined);
    const preparing = prepareAutosaveRecordOffThread(createProject(), 123, SESSION_ID, STORAGE_KEY);
    let settled = false;
    void preparing.then(() => {
      settled = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(true);
      expect(FakeWorker.instances).toHaveLength(0);
      releaseOwner();
      expect(FakeWorker.instances).toHaveLength(0);
      await expect(preparing).resolves.toMatchObject({ kind: 'failed', reason: 'storage-error' });
    } finally {
      releaseOwner();
      FakeWorker.instances[0]?.respond({
        kind: 'failed',
        reason: 'storage-error',
        error: new Error('test cleanup'),
      });
    }
  });

  it('returns the validated record and releases the request worker without preparing on the UI thread', async () => {
    const project = { ...createProject(), notes: 'unchanged recovery values' };
    const expected = records.prepareAutosaveRecord(project, 123, SESSION_ID, STORAGE_KEY);
    expect(expected.kind).toBe('ok');
    const syncPreparation = vi.spyOn(records, 'prepareAutosaveRecord');

    const preparing = prepareAutosaveRecordOffThread(project, 123, SESSION_ID, STORAGE_KEY);
    const worker = FakeWorker.instances[0]!;
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.url.pathname).toMatch(/autosave-preparation-worker\.ts$/);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      project,
      savedAt: 123,
      sessionId: SESSION_ID,
      storageKey: STORAGE_KEY,
    });
    expect(syncPreparation).not.toHaveBeenCalled();
    worker.respond(expected);

    await expect(preparing).resolves.toEqual(expected);
    expectReleased(worker);
    worker.respond({ kind: 'failed', reason: 'storage-error', error: new Error('late') });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(syncPreparation).not.toHaveBeenCalled();
  });

  it('preserves the invalid-project warning and releases its worker', async () => {
    const failure: AutosavePreparation = {
      kind: 'failed',
      reason: 'invalid-project',
      error: new Error('Invalid raster dimensions.'),
    };
    const preparing = prepareAutosaveRecordOffThread(createProject(), 123, SESSION_ID, STORAGE_KEY);
    const worker = FakeWorker.instances[0]!;
    worker.respond(failure);

    await expect(preparing).resolves.toEqual(failure);
    expectReleased(worker);
  });

  it('serializes worker lifetimes and retains independent completion ownership', async () => {
    const project = createProject();
    const firstResult = records.prepareAutosaveRecord(project, 100, SESSION_ID, STORAGE_KEY);
    const secondResult = records.prepareAutosaveRecord(project, 200, SESSION_ID, STORAGE_KEY);
    const first = prepareAutosaveRecordOffThread(project, 100, SESSION_ID, STORAGE_KEY);
    const second = prepareAutosaveRecordOffThread(project, 200, SESSION_ID, STORAGE_KEY);
    const firstWorker = FakeWorker.instances[0]!;
    const lateReply = firstWorker.onmessage!;
    expect(FakeWorker.instances).toHaveLength(1);
    let releasedBeforeReplacement = false;
    firstWorker.terminate.mockImplementation(() => {
      releasedBeforeReplacement = FakeWorker.instances.length === 1;
    });
    firstWorker!.respond(firstResult);
    await expect(first).resolves.toEqual(firstResult);
    expectReleased(firstWorker!);
    expect(releasedBeforeReplacement).toBe(true);
    const secondWorker = FakeWorker.instances[1]!;
    expect(secondWorker.postMessage).toHaveBeenCalledWith({
      project,
      savedAt: 200,
      sessionId: SESSION_ID,
      storageKey: STORAGE_KEY,
    });
    let nextStarted = false;
    const cancelNext = reserveWorkerMemory((release) => {
      nextStarted = true;
      release();
    });
    lateReply({ data: firstResult } as MessageEvent<AutosavePreparation>);
    expect(nextStarted).toBe(false);
    secondWorker.respond(secondResult);
    await expect(second).resolves.toEqual(secondResult);
    expectReleased(secondWorker);
    expect(nextStarted).toBe(true);
    cancelNext();
  });

  it('waits for a non-preemptible owner such as Save before constructing or cloning the snapshot', async () => {
    const releasePreparation = reserveWorkerMemory(() => undefined);
    const project = createProject();
    const expected = records.prepareAutosaveRecord(project, 100, SESSION_ID, STORAGE_KEY);
    const preparing = prepareAutosaveRecordOffThread(project, 100, SESSION_ID, STORAGE_KEY);
    expect(FakeWorker.instances).toHaveLength(0);
    releasePreparation();
    const worker = FakeWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      project,
      savedAt: 100,
      sessionId: SESSION_ID,
      storageKey: STORAGE_KEY,
    });
    worker.respond(expected);
    await expect(preparing).resolves.toEqual(expected);
    expectReleased(worker);
  });

  it('preempts a background job preparation instead of queueing behind it (S3-P2-2)', async () => {
    const preparation = simulatedPreparation(120_000);
    const project = createProject();
    const expected = records.prepareAutosaveRecord(project, 100, SESSION_ID, STORAGE_KEY);
    const preparing = prepareAutosaveRecordOffThread(project, 100, SESSION_ID, STORAGE_KEY);
    try {
      // The preparation retired its heap before the autosave worker was built.
      expect(preparation.preemptions).toBe(1);
      const worker = FakeWorker.instances[0]!;
      expect(preparation.running).toBe(false);
      worker.respond(expected);
      await expect(preparing).resolves.toEqual(expected);
      // It restarts behind the short autosave worker, which is retired first.
      expect(preparation.running).toBe(true);
      expect(preparation.starts).toBe(2);
    } finally {
      preparation.stop();
    }
  });

  it('lands the first autosave on its 30 s tick while four bed-sized photos are prepared', async () => {
    vi.useFakeTimers();
    // Measured in the audit: the four-photo preparation runs 112-164 s, and the
    // first write after an edit came about 125 s later.
    const preparation = simulatedPreparation(150_000);
    const edited = { ...createProject(), notes: 'edit before the preparation' };
    const writes: number[] = [];
    const startedAt = Date.now();
    const stop = startAutosaveLoop(
      () => ({ project: edited, dirty: true, isStreaming: false }),
      30_000,
      undefined,
      async (project) => {
        const prepared = await prepareAutosaveRecordOffThread(project, 1, SESSION_ID, STORAGE_KEY);
        writes.push(Date.now() - startedAt);
        return prepared.kind === 'ok'
          ? { kind: 'ok', savedAt: 1, storageKey: STORAGE_KEY }
          : prepared;
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      const worker = FakeWorker.instances[0]!;
      expect(worker).toBeDefined();
      await vi.advanceTimersByTimeAsync(2_000);
      worker.respond(records.prepareAutosaveRecord(edited, 1, SESSION_ID, STORAGE_KEY));
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toEqual([32_000]);
      // One preemption per changed project: later ticks find it already written.
      await vi.advanceTimersByTimeAsync(150_000);
      expect(preparation.preemptions).toBe(1);
      expect(preparation.completions).toBe(1);
      expect(FakeWorker.instances).toHaveLength(1);
    } finally {
      stop();
      preparation.stop();
    }
  });

  it('reports a constructor failure without attempting synchronous preparation', async () => {
    const error = new Error('Worker blocked.');
    vi.stubGlobal(
      'Worker',
      vi.fn(function unavailableWorker() {
        throw error;
      }),
    );
    const syncPreparation = vi.spyOn(records, 'prepareAutosaveRecord');

    await expect(
      prepareAutosaveRecordOffThread(createProject(), 123, SESSION_ID, STORAGE_KEY),
    ).resolves.toEqual({ kind: 'failed', reason: 'storage-error', error });
    expect(syncPreparation).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
    expectLaneReleased();
  });

  it.each(['post', 'error', 'messageerror'] as const)(
    'settles a %s failure and releases the worker without retrying on the UI thread',
    async (failureKind) => {
      const error = new Error('Worker could not prepare the snapshot.');
      if (failureKind === 'post') {
        vi.stubGlobal(
          'Worker',
          class extends FakeWorker {
            override readonly postMessage = vi.fn<(_request: AutosavePreparationRequest) => void>(
              () => {
                throw error;
              },
            );
          },
        );
      }
      const syncPreparation = vi.spyOn(records, 'prepareAutosaveRecord');
      const preparing = prepareAutosaveRecordOffThread(
        createProject(),
        123,
        SESSION_ID,
        STORAGE_KEY,
      );
      const worker = FakeWorker.instances[0]!;
      if (failureKind === 'error') worker.onerror?.({ message: error.message } as ErrorEvent);
      if (failureKind === 'messageerror') worker.onmessageerror?.();

      await expect(preparing).resolves.toMatchObject({
        kind: 'failed',
        reason: 'storage-error',
        error: expect.any(Error),
      });
      expectReleased(worker);
      expect(syncPreparation).not.toHaveBeenCalled();
      expectLaneReleased();
    },
  );

  it('retains validated compatibility preparation when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const project = { ...createProject(), notes: 'compatible recovery' };
    const expected = records.prepareAutosaveRecord(project, 123, SESSION_ID, STORAGE_KEY);
    const syncPreparation = vi.spyOn(records, 'prepareAutosaveRecord');

    await expect(
      prepareAutosaveRecordOffThread(project, 123, SESSION_ID, STORAGE_KEY),
    ).resolves.toEqual(expected);
    expect(syncPreparation).toHaveBeenCalledExactlyOnceWith(project, 123, SESSION_ID, STORAGE_KEY);

    const cyclic = createProject() as unknown as Record<string, unknown>;
    cyclic['self'] = cyclic;
    await expect(
      prepareAutosaveRecordOffThread(cyclic as unknown as Project, 124, SESSION_ID, STORAGE_KEY),
    ).resolves.toMatchObject({ kind: 'failed', reason: 'invalid-project' });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

/** A background preparation owner as preparation-worker-client reserves it:
 * preemptible, retiring its heap and requeueing its unchanged request. */
function simulatedPreparation(durationMs: number) {
  const state = { starts: 0, preemptions: 0, completions: 0, running: false };
  let cancel: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const reserve = (): void => {
    cancel = reserveWorkerMemory(
      (release) => {
        state.starts += 1;
        state.running = true;
        timer = setTimeout(() => {
          state.running = false;
          state.completions += 1;
          release();
        }, durationMs);
      },
      {
        onPreempt: () => {
          state.preemptions += 1;
          state.running = false;
          if (timer !== null) clearTimeout(timer);
          const previous = cancel;
          reserve();
          previous?.();
        },
      },
    );
  };
  reserve();
  return Object.assign(state, {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      cancel?.();
    },
  });
}

function expectReleased(worker: FakeWorker): void {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
}

function expectLaneReleased(): void {
  let started = false;
  const cancel = reserveWorkerMemory((release) => {
    started = true;
    release();
  });
  cancel();
  expect(started).toBe(true);
}
