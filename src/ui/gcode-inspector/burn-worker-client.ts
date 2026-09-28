// Drives one burn preview worker (ADR-487), as the carved stock's client
// drives its worker: only the latest playback target waits while one burn
// runs, so the view catches up with the playhead without a queue.

import type { BurnLaser, BurnMoves } from './burn-grid';
import type { BurnWorkerRequest, BurnWorkerResponse } from './burn-worker-protocol';
import type { StockTarget } from './stock-carving';

export type BurnWorkerClient = {
  readonly burn: (target: StockTarget) => void;
  readonly dispose: () => void;
};

type WorkerLike = {
  postMessage: (request: BurnWorkerRequest, transfer: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<BurnWorkerResponse>) => void) | null;
};

export function startBurnWorker(
  start: { readonly moves: BurnMoves; readonly laser: BurnLaser },
  onResponse: (response: BurnWorkerResponse) => void,
  createWorker: () => WorkerLike | null = defaultWorker,
): BurnWorkerClient | null {
  const worker = createWorker();
  if (worker === null) return null;
  let busy = true;
  let waiting: StockTarget | null = null;
  let disposed = false;
  const next = (): void => {
    if (waiting === null || disposed || busy) return;
    busy = true;
    worker.postMessage({ kind: 'burn', target: waiting }, []);
    waiting = null;
  };
  worker.onmessage = (event) => {
    if (disposed) return;
    // A program that burns nothing leaves the worker nothing to do.
    busy = event.data.kind === 'none';
    onResponse(event.data);
    next();
  };
  // The worker keeps its own copy of the moves; the view keeps drawing its own.
  const { moves } = start;
  const positions = moves.positions.slice();
  const segKind = moves.segKind.slice();
  const segPower = moves.segPower.slice();
  worker.postMessage(
    { kind: 'start', moves: { ...moves, positions, segKind, segPower }, laser: start.laser },
    [positions.buffer, segKind.buffer, segPower.buffer],
  );
  return {
    burn: (target) => {
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
    return new Worker(new URL('./burn-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}
