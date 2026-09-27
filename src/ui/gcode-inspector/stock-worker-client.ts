// Drives one carved stock worker (ADR-487). Carving asks overlap while
// playback runs, so only the latest ask waits while one is carved: the view
// always catches up to the playhead without a queue building behind it. An
// STL waits for any carve asked before it, so it is the stock as last asked.

import type { StockMoves, StockTarget } from './stock-carving';
import type { StockStl } from './stock-stl';
import type {
  StockDesign,
  StockViewResponse,
  StockWorkerRequest,
  StockWorkerResponse,
} from './stock-worker-protocol';

export type StockWorkerClient = {
  readonly carve: (target: StockTarget) => void;
  /** Compares every carve from now on within the tolerance, or stops; null stops. */
  readonly compare: (toleranceMm: number | null) => void;
  /** The stock as carved so far as an STL solid; null when nothing is left. */
  readonly stl: () => Promise<StockStl | null>;
  readonly dispose: () => void;
};

type WorkerLike = {
  postMessage: (request: StockWorkerRequest, transfer: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<StockWorkerResponse>) => void) | null;
};

export function startStockWorker(
  start: { readonly moves: StockMoves; readonly design?: StockDesign },
  onResponse: (response: StockViewResponse) => void,
  createWorker: () => WorkerLike | null = defaultWorker,
): StockWorkerClient | null {
  const worker = createWorker();
  if (worker === null) return null;
  const { moves } = start;
  let busy = false;
  let waiting: StockTarget | null = null;
  let latest: StockTarget | null = null;
  let toleranceMm: number | null = null;
  let disposed = false;
  let empty = false;
  const stlWaiting: Array<(stl: StockStl | null) => void> = [];
  let stlSent: Array<(stl: StockStl | null) => void> = [];
  const send = (request: StockWorkerRequest, transfer: Transferable[] = []): void =>
    worker.postMessage(request, transfer);
  const next = (): void => {
    if (disposed || busy) return;
    if (waiting !== null) {
      busy = true;
      send({ kind: 'carve', target: waiting, toleranceMm });
      waiting = null;
    } else if (stlWaiting.length > 0) {
      busy = true;
      send({ kind: 'stl' });
      stlSent = stlWaiting.splice(0);
    }
  };
  worker.onmessage = (event) => {
    if (disposed) return;
    const response = event.data;
    // A program that carves nothing leaves the worker nothing to do.
    empty = response.kind === 'none';
    busy = empty;
    if (empty) for (const resolve of stlWaiting.splice(0)) resolve(null);
    if (response.kind === 'stl') for (const resolve of stlSent.splice(0)) resolve(response.stl);
    else onResponse(response);
    next();
  };
  // The worker keeps its own copy of the moves; the view keeps drawing its own.
  const positions = moves.positions.slice();
  const segTool = moves.segTool.slice();
  send(
    {
      kind: 'start',
      moves: { ...moves, positions, segTool },
      ...(start.design === undefined ? {} : { design: start.design }),
    },
    [positions.buffer, segTool.buffer],
  );
  busy = true;
  return {
    carve: (target) => {
      waiting = target;
      latest = target;
      next();
    },
    compare: (tolerance) => {
      toleranceMm = tolerance;
      // Carving to where it already is only compares again.
      waiting ??= latest;
      next();
    },
    stl: () =>
      new Promise((resolve) => {
        if (disposed || empty) return resolve(null);
        stlWaiting.push(resolve);
        next();
      }),
    dispose: () => {
      disposed = true;
      worker.terminate();
      for (const resolve of [...stlWaiting.splice(0), ...stlSent.splice(0)]) resolve(null);
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
