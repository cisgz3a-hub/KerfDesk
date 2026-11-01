/// <reference lib="webworker" />

import { createNetworkSerialWorkerRuntime } from './network-serial-worker-runtime';
import type { NetworkSerialWorkerRequest } from './network-serial-worker-protocol';

const runtime = createNetworkSerialWorkerRuntime({
  post: (message) => self.postMessage(message),
  fetch: (input, init) => fetch(input, init),
});

self.onmessage = (event: MessageEvent<NetworkSerialWorkerRequest>): void => {
  runtime.handle(event.data);
};
