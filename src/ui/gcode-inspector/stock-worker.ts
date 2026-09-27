/// <reference lib="webworker" />
// The carved stock view's simulator (ADR-487): holds the removal grid and
// carves it to wherever playback has got, sending back the rows that changed.

import { createStockCarver, stockLayout, type StockCarver } from './stock-carving';
import type { StockWorkerRequest, StockWorkerResponse } from './stock-worker-protocol';

let carver: StockCarver | null = null;

self.onmessage = (event: MessageEvent<StockWorkerRequest>): void => {
  const request = event.data;
  if (request.kind === 'start') {
    const layout = stockLayout(request.moves);
    carver = layout === null ? null : createStockCarver(layout, request.moves);
    const response: StockWorkerResponse =
      layout === null || carver === null
        ? { kind: 'none' }
        : {
            kind: 'ready',
            layout,
            columns: carver.grid.widthCells,
            rows: carver.grid.heightCells,
          };
    self.postMessage(response);
    return;
  }
  if (carver === null) return;
  const { grid } = carver;
  const change = carver.carveTo(request.target);
  const depth =
    change === null
      ? new Float32Array(0)
      : grid.depth.slice(
          change.firstRow * grid.widthCells,
          (change.firstRow + change.rowCount) * grid.widthCells,
        );
  const response: StockWorkerResponse = {
    kind: 'carved',
    target: request.target,
    firstRow: change?.firstRow ?? 0,
    depth,
  };
  self.postMessage(response, { transfer: [depth.buffer] });
};
