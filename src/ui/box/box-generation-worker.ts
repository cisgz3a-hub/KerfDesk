/// <reference lib="webworker" />

import type {
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from './box-generation-worker-protocol';
import { runBoxGenerationRequest } from './box-generation-worker-runtime';

self.onmessage = (event: MessageEvent<BoxGenerationWorkerRequest>): void => {
  const request = event.data;
  try {
    self.postMessage(runBoxGenerationRequest(request));
  } catch (error) {
    const response: BoxGenerationWorkerResponse = {
      kind: 'fatal',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
