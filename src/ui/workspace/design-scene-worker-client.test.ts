// The pane's worker client only ever wants the newest grid. These cover the
// two behaviours the hook depends on: no worker means "compute it yourself",
// and a superseded request must never deliver a stale grid over a newer one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import {
  computeDesignSceneSourceOffThread,
  isDesignSceneSuperseded,
  resetDesignSceneWorkerForTests,
} from './design-scene-worker-client';

type Posted = { readonly id: number };

class FakeWorker {
  static last: FakeWorker | null = null;
  public onmessage: ((e: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly posted: Posted[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(request: Posted): void {
    this.posted.push(request);
  }
  terminate(): void {
    this.onmessage = null;
  }
  // Replies as the real worker would, for whichever id the test names.
  reply(id: number, source: unknown): void {
    this.onmessage?.({ data: { id, kind: 'ok', source } } as MessageEvent);
  }
}

function installFakeWorker(): void {
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
}

afterEach(() => {
  resetDesignSceneWorkerForTests();
  vi.unstubAllGlobals();
  FakeWorker.last = null;
});

describe('computeDesignSceneSourceOffThread', () => {
  it('returns null when the environment has no Worker, so the caller stays synchronous', () => {
    vi.stubGlobal('Worker', undefined);
    expect(computeDesignSceneSourceOffThread(createProject(), DEFAULT_OUTPUT_SCOPE)).toBeNull();
  });

  it('delivers the newest grid and abandons the superseded request', async () => {
    installFakeWorker();
    const first = computeDesignSceneSourceOffThread(createProject(), DEFAULT_OUTPUT_SCOPE);
    const second = computeDesignSceneSourceOffThread(createProject(), DEFAULT_OUTPUT_SCOPE);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const firstOutcome = await first?.then(
      () => 'resolved',
      (err: unknown) => (isDesignSceneSuperseded(err) ? 'superseded' : 'other-error'),
    );
    expect(firstOutcome).toBe('superseded');

    const worker = FakeWorker.last;
    expect(worker).not.toBeNull();
    const newestId = worker?.posted.at(-1)?.id ?? -1;
    worker?.reply(newestId, 'newest-grid');
    await expect(second).resolves.toBe('newest-grid');
  });

  it('ignores a reply whose id is not the newest request', async () => {
    installFakeWorker();
    const promise = computeDesignSceneSourceOffThread(createProject(), DEFAULT_OUTPUT_SCOPE);
    const worker = FakeWorker.last;
    const newestId = worker?.posted.at(-1)?.id ?? -1;

    // A late reply from an earlier request must not settle the current one.
    worker?.reply(newestId - 1, 'stale-grid');
    worker?.reply(newestId, 'fresh-grid');
    await expect(promise).resolves.toBe('fresh-grid');
  });
});
