import type {
  PreparedSurfacing,
  SurfacingWorkerInput,
  SurfacingWorkerRequest,
  SurfacingWorkerResponse,
} from './surfacing-worker-protocol';

export type SurfacingStreamTask = {
  readonly ready: Promise<PreparedSurfacing>;
  readonly chunks: AsyncIterable<string>;
  readonly dispose: () => void;
};

/** One owned worker per save. Termination cancels even a very long preflight. */
export function startSurfacingStream(
  input: SurfacingWorkerInput,
  signal: AbortSignal,
): SurfacingStreamTask {
  const worker = new Worker(new URL('./surfacing-worker.ts', import.meta.url), { type: 'module' });
  let pending: {
    resolve: (response: SurfacingWorkerResponse) => void;
    reject: (error: Error) => void;
  } | null = null;
  let closed: Error | null = null;
  const fail = (error: Error): void => {
    if (closed !== null) return;
    closed = error;
    worker.terminate();
    signal.removeEventListener('abort', abort);
    pending?.reject(error);
    pending = null;
  };
  const abort = (): void => fail(new DOMException('Surfacing save cancelled.', 'AbortError'));
  const request = (message: SurfacingWorkerRequest): Promise<SurfacingWorkerResponse> => {
    if (closed !== null) return Promise.reject(closed);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        worker.postMessage(message);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  worker.onmessage = (event: MessageEvent<SurfacingWorkerResponse>): void => {
    const response = event.data;
    if (response.kind === 'error') {
      fail(new Error(response.message));
      return;
    }
    const waiting = pending;
    pending = null;
    waiting?.resolve(response);
  };
  worker.onerror = (): void => fail(new Error('Background surfacing generation failed.'));
  worker.onmessageerror = (): void =>
    fail(new Error('Could not read the surfacing worker response.'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const ready = request({ kind: 'prepare', input }).then((response) => {
    if (response.kind !== 'ready') throw new Error('Unexpected surfacing preparation response.');
    return response.prepared;
  });
  async function* readChunks(): AsyncGenerator<string> {
    await ready;
    while (true) {
      signal.throwIfAborted();
      const response = await request({ kind: 'next' });
      if (response.kind !== 'chunk') throw new Error('Unexpected surfacing output response.');
      if (response.done) return;
      yield response.text;
    }
  }
  return { ready, chunks: { [Symbol.asyncIterator]: readChunks }, dispose: abort };
}
