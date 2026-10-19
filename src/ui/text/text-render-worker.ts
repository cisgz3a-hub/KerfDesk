/// <reference lib="webworker" />

// Lays out canvas text off the UI thread (ADR-631): opentype.js parsing,
// HarfBuzz shaping for complex scripts, and the outline conversion.

import type {
  TextWorkerMessage,
  TextWorkerRequest,
  TextWorkerResponse,
} from './text-render-worker-protocol';
import { createTextWorkerRuntime } from './text-render-worker-runtime';

const runtime = createTextWorkerRuntime();

self.onmessage = (event: MessageEvent<TextWorkerRequest>): void => {
  const request = event.data;
  void runtime
    .respond(request)
    .then(({ response, transfer }) => self.postMessage(response, transfer))
    .catch((error: unknown) => {
      const response: TextWorkerResponse = {
        id: request.id,
        kind: 'fatal',
        message: error instanceof Error ? error.message : String(error),
      };
      try {
        self.postMessage(response);
      } catch (replyError) {
        // If even a small fatal reply cannot cross, raise a worker error so
        // the client retires this request instead of waiting indefinitely.
        setTimeout(() => {
          throw replyError;
        }, 0);
      }
    });
};

// The client counts an error before this as a worker that never started.
const ready: TextWorkerMessage = { kind: 'ready' };
self.postMessage(ready);
