import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { reserveWorkerMemory } from '../worker-memory-lane';
import {
  prepareAutosaveRecordOffThread,
  type AutosavePreparationRequest,
} from './autosave-preparation-client';
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('waits for an active preparation before constructing or cloning the snapshot', async () => {
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
