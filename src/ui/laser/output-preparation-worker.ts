/// <reference lib="webworker" />

import { prepareOutputRequest } from './output-preparation';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
} from './output-preparation-protocol';

self.onmessage = async (event: MessageEvent<OutputPreparationRequest>): Promise<void> => {
  let response: OutputPreparationResponse;
  try {
    response = await prepareOutputRequest(event.data);
  } catch (error) {
    response = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
