// The serial worker's entry point (ADR-334). Deliberately a shell: all of the
// behaviour lives in `serial-worker-core.ts`, which a test can drive with real
// streams, because nothing inside a Worker is reachable from this repository's
// test environment.

/// <reference lib="webworker" />

import { createSerialWorkerCore } from './serial-worker-core';
import type { SerialWorkerRequest } from './serial-worker-protocol';

const core = createSerialWorkerCore({
  post: (message) => {
    self.postMessage(message);
  },
});

self.onmessage = (event: MessageEvent<SerialWorkerRequest>): void => {
  core.handle(event.data);
};
