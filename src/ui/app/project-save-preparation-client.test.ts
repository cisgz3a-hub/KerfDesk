import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { Project } from '../../core/scene';
import {
  ProjectSaveTestWorker,
  currentProjectSaveWorker,
} from '../../__fixtures__/project-save-worker';
import { reserveWorkerMemory } from '../worker-memory-lane';
import * as persistence from '../../io/project/prepare-project-persistence';
import { prepareProjectSaveOffThread } from './project-save-preparation-client';
import { prepareProjectSaveMessage } from './project-save-preparation';

beforeEach(() => {
  ProjectSaveTestWorker.instances = [];
  vi.stubGlobal('Worker', ProjectSaveTestWorker);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('manual project preparation worker', () => {
  it('returns only validated JSON, releases its worker, and never validates on the sending thread', async () => {
    const project = createProject();
    const expected = prepareProjectSaveMessage(project);
    const synchronous = vi.spyOn(persistence, 'prepareProjectForPersistence');
    const preparing = prepareProjectSaveOffThread(project, new AbortController().signal);
    const worker = currentProjectSaveWorker();
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.url.pathname).toMatch(/project-save-preparation-worker\.ts$/);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      project,
      mode: 'canonical',
      representation: 'original',
    });
    expect(synchronous).not.toHaveBeenCalled();
    worker.respond(expected);
    await expect(preparing).resolves.toEqual(expected);
    expect(expected).not.toHaveProperty('project');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });

  it('cancels a queued reservation without starting a worker or validation', async () => {
    let release = (): void => undefined;
    reserveWorkerMemory((done) => {
      release = done;
    });
    const controller = new AbortController();
    const preparing = prepareProjectSaveOffThread(createProject(), controller.signal);
    expect(ProjectSaveTestWorker.instances).toHaveLength(0);
    controller.abort();
    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    release();
    expect(ProjectSaveTestWorker.instances).toHaveLength(0);
  });

  it('terminates an active cancelled worker before granting the next owner and ignores late replies', async () => {
    const controller = new AbortController();
    const first = prepareProjectSaveOffThread(createProject(), controller.signal);
    const worker = currentProjectSaveWorker();
    const late = worker.onmessage!;
    let firstTerminatedBeforeGrant = false;
    const release = reserveWorkerMemory((done) => {
      firstTerminatedBeforeGrant = worker.terminate.mock.calls.length === 1;
      done();
    });
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    late({ data: { kind: 'ok', json: 'late' } } as MessageEvent);
    expect(firstTerminatedBeforeGrant).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce();
    release();
  });

  it.each(['error', 'messageerror'] as const)(
    'settles %s and releases the memory lane',
    async (kind) => {
      const preparing = prepareProjectSaveOffThread(createProject(), new AbortController().signal);
      const worker = currentProjectSaveWorker();
      if (kind === 'error') worker.onerror?.({ message: 'worker failed' } as ErrorEvent);
      else worker.onmessageerror?.();
      await expect(preparing).resolves.toMatchObject({ kind: 'failed' });
      expect(worker.terminate).toHaveBeenCalledOnce();
      const next = prepareProjectSaveOffThread(createProject(), new AbortController().signal);
      currentProjectSaveWorker().respond({ kind: 'invalid', reason: 'semantic drift' });
      await expect(next).resolves.toEqual({ kind: 'invalid', reason: 'semantic drift' });
    },
  );

  it('settles a startup or transfer error without falling back to synchronous preparation', async () => {
    const synchronous = vi.spyOn(persistence, 'prepareProjectForPersistence');
    vi.stubGlobal(
      'Worker',
      class {
        readonly postMessage = vi.fn();
        constructor() {
          throw new Error('no worker');
        }
      },
    );
    await expect(
      prepareProjectSaveOffThread(createProject(), new AbortController().signal),
    ).resolves.toMatchObject({ kind: 'failed', reason: expect.stringContaining('no worker') });
    vi.stubGlobal('Worker', ProjectSaveTestWorker);
    const next = prepareProjectSaveOffThread(createProject(), new AbortController().signal);
    currentProjectSaveWorker().respond({ kind: 'ok', json: '{}' });
    await expect(next).resolves.toMatchObject({ kind: 'ok' });
    expect(synchronous).not.toHaveBeenCalled();
  });

  it('terminates and releases a worker whose project transfer throws', async () => {
    class TransferFailureWorker extends ProjectSaveTestWorker {
      override readonly postMessage = vi.fn(() => {
        throw new Error('project transfer failed');
      });
    }
    vi.stubGlobal('Worker', TransferFailureWorker);
    const synchronous = vi.spyOn(persistence, 'prepareProjectForPersistence');
    await expect(
      prepareProjectSaveOffThread(createProject(), new AbortController().signal),
    ).resolves.toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('project transfer failed'),
    });
    expect(currentProjectSaveWorker().terminate).toHaveBeenCalledOnce();
    vi.stubGlobal('Worker', ProjectSaveTestWorker);
    const next = prepareProjectSaveOffThread(createProject(), new AbortController().signal);
    currentProjectSaveWorker().respond({ kind: 'ok', json: '{}' });
    await expect(next).resolves.toMatchObject({ kind: 'ok' });
    expect(synchronous).not.toHaveBeenCalled();
  });

  it('reports an unavailable worker without blocking the UI with synchronous validation', async () => {
    vi.stubGlobal('Worker', undefined);
    const synchronous = vi.spyOn(persistence, 'prepareProjectForPersistence');
    await expect(
      prepareProjectSaveOffThread(createProject(), new AbortController().signal),
    ).resolves.toMatchObject({ kind: 'failed', reason: expect.stringContaining('unavailable') });
    expect(synchronous).not.toHaveBeenCalled();
  });

  it('sends malformed un-packable geometry unchanged for canonical worker validation', async () => {
    const valid = createProject();
    const bad = { ...valid, scene: { ...valid.scene, objects: null } } as unknown as Project;
    const preparing = prepareProjectSaveOffThread(bad, new AbortController().signal);
    const worker = currentProjectSaveWorker();
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      project: bad,
      mode: 'canonical',
      representation: 'original',
    });
    const expected = prepareProjectSaveMessage(bad);
    expect(expected.kind).toBe('invalid');
    worker.respond(expected);
    await expect(preparing).resolves.toEqual(expected);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
