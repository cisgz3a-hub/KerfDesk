/// <reference lib="webworker" />

import {
  acceptCanvasCompilationBridgeConnection,
  runCanvasCompilationWork,
} from './canvas-compilation-worker-pool';
import type {
  CncRemovalGridWorkerRequest,
  CncRemovalGridWorkerResponse,
} from './cnc-removal-grid-worker-protocol';

self.onmessage = (event: MessageEvent<CncRemovalGridWorkerRequest>): void => {
  if (acceptCanvasCompilationBridgeConnection(event.data)) return;
  void prepare(event.data);
};

async function prepare(request: CncRemovalGridWorkerRequest): Promise<void> {
  let response: CncRemovalGridWorkerResponse;
  try {
    const results = await runCanvasCompilationWork({
      jobId: `cnc-${request.kind}:${request.id}`,
      tasks: [
        {
          taskId: request.kind,
          payload:
            request.kind === 'grid'
              ? {
                  kind: 'cnc-removal-grid',
                  device: request.device,
                  machine: request.machine,
                  toolpath: request.toolpath,
                  scrubFraction: request.scrubFraction,
                }
              : { kind: 'cnc-cut3d-surface', grid: request.grid },
        },
      ],
    });
    const result = results[0];
    if (results.length !== 1) throw new Error('CNC preview worker returned an unbound result.');
    if (request.kind === 'grid' && result?.kind === 'cnc-removal-grid') {
      response = { id: request.id, kind: 'grid', grid: result.output };
    } else if (request.kind === 'surface' && result?.kind === 'cnc-cut3d-surface') {
      response = { id: request.id, kind: 'surface', surface: result.output };
    } else {
      throw new Error('CNC preview worker returned a mismatched result.');
    }
  } catch (error) {
    response = {
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response, responseTransfers(response));
}

function responseTransfers(response: CncRemovalGridWorkerResponse): Transferable[] {
  if (response.kind === 'grid') return response.grid === null ? [] : [response.grid.depth.buffer];
  if (response.kind === 'surface') {
    return [
      response.surface.positions.buffer,
      response.surface.indices.buffer,
      response.surface.normals.buffer,
    ];
  }
  return [];
}
