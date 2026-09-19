/// <reference lib="webworker" />
import type { TextRenderResult } from '../../core/text/text-to-polylines';
import { weldTextRender } from '../../core/text/text-weld';
import type { TextWeldWorkerResponse } from './text-weld-worker-protocol';

self.onmessage = (event: MessageEvent<TextRenderResult>): void => {
  let response: TextWeldWorkerResponse;
  try {
    response = weldTextRender(event.data);
  } catch (error) {
    response = {
      kind: 'error',
      error: {
        kind: 'operation-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  self.postMessage(response);
};
