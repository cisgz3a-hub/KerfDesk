/// <reference lib="webworker" />
// The burn preview's simulator (ADR-487): holds the burn grid and burns it to
// wherever playback has got, sending back the rows that changed.

import { burnLayout, createBurner, type Burner } from './burn-grid';
import type { BurnWorkerRequest, BurnWorkerResponse } from './burn-worker-protocol';

let burner: Burner | null = null;

self.onmessage = (event: MessageEvent<BurnWorkerRequest>): void => {
  const request = event.data;
  if (request.kind === 'start') {
    const layout = burnLayout(request.moves, request.laser);
    burner = layout === null ? null : createBurner(layout, request.moves, request.laser);
    const response: BurnWorkerResponse =
      burner === null ? { kind: 'none' } : { kind: 'ready', layout: burner.layout };
    self.postMessage(response);
    return;
  }
  if (burner === null) return;
  const change = burner.burnTo(request.target);
  const { columns } = burner.layout;
  const darkness =
    change === null
      ? new Uint8Array(0)
      : burner.darkness.slice(
          change.firstRow * columns,
          (change.firstRow + change.rowCount) * columns,
        );
  const response: BurnWorkerResponse = {
    kind: 'burned',
    target: request.target,
    firstRow: change?.firstRow ?? 0,
    darkness,
  };
  self.postMessage(response, { transfer: [darkness.buffer] });
};
