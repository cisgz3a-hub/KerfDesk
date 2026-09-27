// Drives one carved stock worker (ADR-487). Carving asks overlap while
// playback runs, so only the latest ask waits while one is carved: the view
// always catches up to the playhead without a queue building behind it.

import type { StockMoves, StockTarget } from './stock-carving';
import type { StockWorkerRequest, StockWorkerResponse } from './stock-worker-protocol';

export type StockWorkerClient = {
  readonly carve: (target: StockTarget) => void;
  readonly dispose: () => void;
};

type WorkerLike = {
  postMessage: (request: StockWorkerRequest, transfer: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<StockWorkerResponse>) => void) | null;
};

export function startStockWorker(
  moves: StockMoves,
  onResponse: (response: StockWorkerResponse) => void,
  createWorker: () => WorkerLike | null = defaultWorker,
): StockWorkerClient | null {
  const worker = createWorker();
  if (worker === null) return null;
  let busy = false;
  let waiting: StockTarget | null = null;
  let disposed = false;
  const send = (request: StockWorkerRequest, transfer: Transferable[] = []): void =>
    worker.postMessage(request, transfer);
  const next = (): void => {
    if (waiting === null || disposed || busy) return;
    busy = true;
    send({ kind: 'carve', target: waiting });
    waiting = null;
  };
  worker.onmessage = (event) => {
    if (disposed) return;
    // A program that carves nothing leaves the worker nothing to do.
    busy = event.data.kind === 'none';
    onResponse(event.data);
    next();
  };
  // The worker keeps its own copy of the moves; the view keeps drawing its own.
  const positions = moves.positions.slice();
  const segTool = moves.segTool.slice();
  send({ kind: 'start', moves: { ...moves, positions, segTool } }, [
    positions.buffer,
    segTool.buffer,
  ]);
  busy = true;
  return {
    carve: (target) => {
      waiting = target;
      next();
    },
    dispose: () => {
      disposed = true;
      worker.terminate();
    },
  };
}

function defaultWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./stock-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}
