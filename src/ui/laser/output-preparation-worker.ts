/// <reference lib="webworker" />

import { prepareOutputRequest } from './output-preparation';
import type {
  OutputPreparationWireEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { acceptCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-pool';
import { unpackProjectMessage } from '../packed-project-transfer';

self.onmessage = (event: MessageEvent<OutputPreparationWireEnvelope>): void => {
  if (acceptCanvasCompilationBridgeConnection(event.data)) return;
  void prepare(event.data);
};

async function prepare(envelope: OutputPreparationWireEnvelope): Promise<void> {
  const { requestId, request } = envelope;
  let response: OutputPreparationResponse;
  try {
    response = await prepareOutputRequest(
      { ...request, project: unpackProjectMessage(request.project) },
      {
        jobId: `output:${requestId}`,
        onProgress: (progress) => {
          const update: OutputPreparationResult = { requestId, progress };
          self.postMessage(update);
        },
        onFrameBounds: (frameBounds) => {
          const update: OutputPreparationResult = { requestId, frameBounds };
          self.postMessage(update);
        },
      },
    );
  } catch (error) {
    response = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const result: OutputPreparationResult = { requestId, response };
  self.postMessage(result);
}
