/// <reference lib="webworker" />

import { prepareOutputRequest } from './output-preparation';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';

// The client reuses this worker across preparations, so the reply must name
// the request it answers. Nothing is retained between messages: every response
// is computed from its own envelope's request alone.
self.onmessage = async (event: MessageEvent<OutputPreparationEnvelope>): Promise<void> => {
  const { requestId, request } = event.data;
  let response: OutputPreparationResponse;
  try {
    response = await prepareOutputRequest(request);
  } catch (error) {
    response = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const result: OutputPreparationResult = { requestId, response };
  self.postMessage(result);
};
