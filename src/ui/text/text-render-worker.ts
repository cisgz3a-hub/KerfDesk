/// <reference lib="webworker" />

// Lays out canvas text off the UI thread (ADR-624): opentype.js parsing,
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
  runtime.respond(request).then(
    ({ response, transfer }) => self.postMessage(response, transfer),
    (error: unknown) => {
      const response: TextWorkerResponse = {
        id: request.id,
        kind: 'fatal',
        message: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    },
  );
};

// The client counts an error before this as a worker that never started.
const ready: TextWorkerMessage = { kind: 'ready' };
self.postMessage(ready);
