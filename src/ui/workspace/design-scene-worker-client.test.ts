// The pane's worker client only ever wants the newest grid. These cover the
// two behaviours the hook depends on: no worker means "compute it yourself",
// and a superseded request must never deliver a stale grid over a newer one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { designCarveSource } from '../design-studio/preview3d/design-carve-source';
import {
  computeDesignSceneSourceOffThread,
  isDesignSceneSuperseded,
  resetDesignSceneWorkerForTests,
  simulateDesignCarveOffThread,
} from './design-scene-worker-client';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';

type Posted = { readonly id: number; readonly kind: 'scene' | 'simulation' };

class FakeWorker {
  static last: FakeWorker | null = null;
  static failBridgeConnection = false;
  public onmessage: ((e: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly posted: Posted[] = [];
  public bridgeConnected = false;
  public terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(request: unknown): void {
    if (isCanvasCompilationBridgeConnection(request)) {
      if (FakeWorker.failBridgeConnection) throw new Error('bridge transfer failed');
      this.bridgeConnected = true;
      return;
    }
    this.posted.push(request as Posted);
  }
  terminate(): void {
    this.terminated = true;
    this.onmessage = null;
  }
  // Replies as the real worker would, for whichever id the test names.
  replyScene(id: number, source: unknown): void {
    this.onmessage?.({ data: { id, kind: 'scene', source } } as MessageEvent);
  }
  replySimulation(id: number, result: unknown): void {
    this.onmessage?.({ data: { id, kind: 'simulation', result } } as MessageEvent);
  }
}

function installFakeWorker(): void {
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
}

afterEach(() => {
  resetDesignSceneWorkerForTests();
  vi.unstubAllGlobals();
  FakeWorker.last = null;
  FakeWorker.failBridgeConnection = false;
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
    expect(worker?.bridgeConnected).toBe(true);
    const newestId = worker?.posted.at(-1)?.id ?? -1;
    worker?.replyScene(newestId, 'newest-grid');
    await expect(second).resolves.toBe('newest-grid');
  });

  it('fails closed and terminates the outer worker when bridge transfer fails', () => {
    installFakeWorker();
    FakeWorker.failBridgeConnection = true;

    expect(computeDesignSceneSourceOffThread(createProject(), DEFAULT_OUTPUT_SCOPE)).toBeNull();
    expect(FakeWorker.last?.terminated).toBe(true);
  });

  it('ignores a reply whose id is not the newest request', async () => {
    installFakeWorker();
    const promise = computeDesignSceneSourceOffThread(createProject(), DEFAULT_OUTPUT_SCOPE);
    const worker = FakeWorker.last;
    const newestId = worker?.posted.at(-1)?.id ?? -1;

    // A late reply from an earlier request must not settle the current one.
    worker?.replyScene(newestId - 1, 'stale-grid');
    worker?.replyScene(newestId, 'fresh-grid');
    await expect(promise).resolves.toBe('fresh-grid');
  });

  it('delivers an explicit bit simulation through the same outer worker', async () => {
    installFakeWorker();
    const project = createProject();
    const expected = { kind: 'empty' as const, reason: 'no cutting moves' };
    const promise = simulateDesignCarveOffThread(project, designCarveSource(project));
    const worker = FakeWorker.last;
    const request = worker?.posted.at(-1);

    expect(request?.kind).toBe('simulation');
    worker?.replySimulation(request?.id ?? -1, expected);
    await expect(promise).resolves.toBe(expected);
  });
});
