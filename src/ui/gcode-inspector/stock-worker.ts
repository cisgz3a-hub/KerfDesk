/// <reference lib="webworker" />
// The carved stock view's simulator (ADR-487): holds the removal grid and
// carves it to wherever playback has got, sending back the rows that changed,
// compares it with the design when the view asks, and writes it as an STL
// solid to save.

import { createStockCarver, stockLayout, type StockCarver } from './stock-carving';
import { compareWithDesign } from './stock-compare';
import { designTarget } from './stock-design-target';
import { stockToStl } from './stock-stl';
import type { StockWorkerRequest, StockWorkerResponse } from './stock-worker-protocol';

let carver: StockCarver | null = null;
let bottomZ = 0;
let design: Float32Array | null = null;

self.onmessage = (event: MessageEvent<StockWorkerRequest>): void => {
  const request = event.data;
  if (request.kind === 'start') return start(request);
  if (carver === null) return;
  if (request.kind === 'stl') return saveStl(carver);
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
    comparison:
      design === null || request.toleranceMm === null
        ? null
        : compareWithDesign(grid.depth, design, request.toleranceMm),
  };
  self.postMessage(response, { transfer: [depth.buffer] });
};

function start(request: Extract<StockWorkerRequest, { kind: 'start' }>): void {
  const layout = stockLayout(request.moves, request.design?.thicknessMm);
  carver = layout === null ? null : createStockCarver(layout, request.moves);
  design = carver === null ? null : designTarget(carver.grid, request.design?.reliefs ?? []);
  if (layout === null || carver === null) {
    const none: StockWorkerResponse = { kind: 'none' };
    self.postMessage(none);
    return;
  }
  bottomZ = layout.bottomZ;
  // The view draws its own copy; the worker keeps this one to compare with.
  const drawn = design?.slice() ?? null;
  const response: StockWorkerResponse = {
    kind: 'ready',
    layout,
    columns: carver.grid.widthCells,
    rows: carver.grid.heightCells,
    design: drawn,
  };
  self.postMessage(response, { transfer: drawn === null ? [] : [drawn.buffer] });
}

function saveStl(stock: StockCarver): void {
  const stl = stockToStl({ ...stock.grid, bottomZ });
  const response: StockWorkerResponse = { kind: 'stl', stl };
  self.postMessage(response, { transfer: stl === null ? [] : [stl.bytes] });
}
