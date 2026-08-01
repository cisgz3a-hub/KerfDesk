/// <reference lib="webworker" />

import { prepareOutputRequest } from './output-preparation';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
} from './output-preparation-protocol';

self.onmessage = (event: MessageEvent<OutputPreparationRequest>): void => {
  let response: OutputPreparationResponse;
  try {
    response = prepareOutputRequest(event.data);
  } catch (error) {
    response = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
