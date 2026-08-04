import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { ViewerDialogSceneResult } from './use-viewer-dialog-scene';
import { Cut3DOffscreenBackpressure } from './cut3d-offscreen-backpressure';
import { createCut3DOffscreenInput, measureViewport } from './cut3d-offscreen-input';
import {
  isCut3DOffscreenWorkerResponse,
  type Cut3DOffscreenWorkerRequest,
  type Cut3DOffscreenWorkerResponse,
} from './cut3d-offscreen-worker-protocol';

export type Cut3DWorkerPort = Pick<
  Worker,
  'onerror' | 'onmessage' | 'onmessageerror' | 'postMessage' | 'terminate'
>;

type SessionOutcome =
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

type SessionState =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'disposed' };

type Deferred = {
  readonly promise: Promise<SessionOutcome>;
  readonly resolve: (outcome: SessionOutcome) => void;
};

const CANCELLED_REASON = 'The 3D renderer was cancelled.';
const WORKER_ERROR_REASON = 'The background 3D renderer stopped unexpectedly.';
const CLONE_ERROR_REASON = 'The background 3D renderer returned an unreadable response.';

export class Cut3DOffscreenSession {
  readonly canvas: HTMLCanvasElement;
  readonly mesh: ReliefSurfaceMeshWithNormals;
  readonly stockThicknessMm: number;
  readonly sessionId: number;

  private readonly worker: Cut3DWorkerPort;
  private readonly deferred: Deferred;
  private readonly failureReporters = new Set<(reason: string) => void>();
  private readonly onUnused: () => void;
  private readonly onRetired: () => void;
  private readonly input: ReturnType<typeof createCut3DOffscreenInput>;
  private readonly backpressure: Cut3DOffscreenBackpressure;
  private state: SessionState = { kind: 'starting' };
  private referenceCount = 0;
  private isWorkerStopped = false;

  constructor(input: {
    readonly canvas: HTMLCanvasElement;
    readonly mesh: ReliefSurfaceMeshWithNormals;
    readonly stockThicknessMm: number;
    readonly sessionId: number;
    readonly worker: Cut3DWorkerPort;
    readonly onUnused: () => void;
    readonly onRetired: () => void;
  }) {
    this.canvas = input.canvas;
    this.mesh = input.mesh;
    this.stockThicknessMm = input.stockThicknessMm;
    this.sessionId = input.sessionId;
    this.worker = input.worker;
    this.onUnused = input.onUnused;
    this.onRetired = input.onRetired;
    this.deferred = createDeferred();
    this.backpressure = new Cut3DOffscreenBackpressure(input.sessionId, (request) =>
      this.send(request),
    );
    this.input = createCut3DOffscreenInput(
      input.canvas,
      (control) => this.backpressure.queueControl(control),
      (size) => this.backpressure.queueResize(size),
    );
    this.installWorkerHandlers();
    this.transferAndInitialize();
  }

  get references(): number {
    return this.referenceCount;
  }

  isCompatible(
    canvas: HTMLCanvasElement,
    mesh: ReliefSurfaceMeshWithNormals,
    stockThicknessMm: number,
  ): boolean {
    return (
      this.canvas === canvas &&
      this.mesh === mesh &&
      this.stockThicknessMm === stockThicknessMm &&
      (this.state.kind === 'starting' || this.state.kind === 'ready')
    );
  }

  attach(
    signal: AbortSignal,
    reportFailure: (reason: string) => void,
  ): Promise<ViewerDialogSceneResult> {
    if (this.state.kind === 'disposed') {
      return Promise.resolve({ kind: 'no-webgl', reason: CANCELLED_REASON });
    }
    this.referenceCount += 1;
    this.failureReporters.add(reportFailure);
    let isReleased = false;
    const release = (): void => {
      if (isReleased) return;
      isReleased = true;
      signal.removeEventListener('abort', release);
      this.failureReporters.delete(reportFailure);
      this.referenceCount = Math.max(0, this.referenceCount - 1);
      if (this.referenceCount === 0) this.onUnused();
    };
    signal.addEventListener('abort', release, { once: true });
    if (signal.aborted) release();
    return this.deferred.promise.then((outcome) => {
      if (outcome.kind === 'failed') {
        release();
        return { kind: 'no-webgl', reason: outcome.reason };
      }
      return { kind: 'ok', handle: { dispose: release } };
    });
  }

  dispose(): void {
    if (this.state.kind === 'disposed') return;
    if (this.state.kind === 'starting') {
      this.deferred.resolve({ kind: 'failed', reason: CANCELLED_REASON });
    }
    this.state = { kind: 'disposed' };
    this.stopWorker();
    this.onRetired();
  }

  private installWorkerHandlers(): void {
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      if (isCut3DOffscreenWorkerResponse(event.data)) this.handleResponse(event.data);
      else this.fail(CLONE_ERROR_REASON);
    };
    this.worker.onerror = () => this.fail(WORKER_ERROR_REASON);
    this.worker.onmessageerror = () => this.fail(CLONE_ERROR_REASON);
  }

  private transferAndInitialize(): void {
    try {
      const viewport = measureViewport(this.canvas);
      const offscreen = this.canvas.transferControlToOffscreen();
      const request: Cut3DOffscreenWorkerRequest = {
        kind: 'init',
        sessionId: this.sessionId,
        canvas: offscreen,
        mesh: this.mesh,
        stockThicknessMm: this.stockThicknessMm,
        ...viewport,
      };
      this.worker.postMessage(request, [
        offscreen,
        this.mesh.positions.buffer,
        this.mesh.indices.buffer,
        this.mesh.normals.buffer,
      ]);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private handleResponse(response: Cut3DOffscreenWorkerResponse): void {
    if (this.state.kind === 'disposed') return;
    if (response.sessionId !== this.sessionId) {
      this.fail(CLONE_ERROR_REASON);
      return;
    }
    if (response.kind === 'error') {
      this.fail(response.message);
    } else if (response.kind === 'ready') {
      this.ready();
    } else {
      this.presented(response);
    }
  }

  private ready(): void {
    if (this.state.kind !== 'starting' || !this.backpressure.hasInitialPresentation) {
      this.fail(CLONE_ERROR_REASON);
      return;
    }
    this.state = { kind: 'ready' };
    this.canvas.dataset.sceneState = 'ready';
    this.deferred.resolve({ kind: 'ready' });
    this.input.start();
  }

  private presented(
    response: Extract<Cut3DOffscreenWorkerResponse, { readonly kind: 'presented' }>,
  ): void {
    const expectedState = response.source === 'initial' ? 'starting' : 'ready';
    if (this.state.kind !== expectedState || !this.backpressure.presented(response)) {
      this.fail(CLONE_ERROR_REASON);
      return;
    }
    this.canvas.dataset.frameRevision = String(response.revision);
  }

  private send(request: Cut3DOffscreenWorkerRequest): void {
    try {
      this.worker.postMessage(request);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(reason: string): void {
    if (this.state.kind === 'disposed' || this.state.kind === 'failed') return;
    const wasReady = this.state.kind === 'ready';
    this.state = { kind: 'failed', reason };
    this.canvas.dataset.sceneState = 'unavailable';
    if (wasReady) {
      for (const report of this.failureReporters) report(reason);
    } else {
      this.deferred.resolve({ kind: 'failed', reason });
    }
    this.stopWorker();
    this.onRetired();
  }

  private stopWorker(): void {
    if (this.isWorkerStopped) return;
    this.isWorkerStopped = true;
    this.input.dispose();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    try {
      this.worker.postMessage({ kind: 'dispose', sessionId: this.sessionId });
    } catch {
      // Termination below is the authoritative cancellation path.
    }
    this.worker.terminate();
  }
}

function createDeferred(): Deferred {
  let resolvePromise: (outcome: SessionOutcome) => void = () => undefined;
  const promise = new Promise<SessionOutcome>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
