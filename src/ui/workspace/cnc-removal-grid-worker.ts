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
      jobId: `removal-grid:${request.id}`,
      tasks: [
        {
          taskId: 'grid',
          payload: {
            kind: 'cnc-removal-grid',
            device: request.device,
            machine: request.machine,
            toolpath: request.toolpath,
            scrubFraction: request.scrubFraction,
          },
        },
      ],
    });
    const result = results[0];
    if (results.length !== 1 || result?.kind !== 'cnc-removal-grid') {
      throw new Error('Removal-grid worker returned an unbound result.');
    }
    response = { id: request.id, kind: 'ok', grid: result.output };
  } catch (error) {
    response = {
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
}
