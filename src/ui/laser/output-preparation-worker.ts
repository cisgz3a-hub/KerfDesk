/// <reference lib="webworker" />

import { prepareOutputRequest } from './output-preparation';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { acceptCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-pool';

self.onmessage = (event: MessageEvent<OutputPreparationEnvelope>): void => {
  if (acceptCanvasCompilationBridgeConnection(event.data)) return;
  void prepare(event.data);
};

async function prepare(envelope: OutputPreparationEnvelope): Promise<void> {
  const { requestId, request } = envelope;
  let response: OutputPreparationResponse;
  try {
    response = await prepareOutputRequest(request, {
      jobId: `output:${requestId}`,
      onProgress: (progress) => {
        const update: OutputPreparationResult = { requestId, progress };
        self.postMessage(update);
      },
    });
  } catch (error) {
    response = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const result: OutputPreparationResult = { requestId, response };
  self.postMessage(result);
}
