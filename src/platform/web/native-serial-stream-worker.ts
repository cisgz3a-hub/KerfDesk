/// <reference lib="webworker" />

import { createNativeSerialWorkerRuntime } from './native-serial-worker-runtime';
import type { NativeSerialWorkerRequest } from './native-serial-worker-protocol';

const workerNavigator = navigator as WorkerNavigator & {
  readonly serial?: Pick<Serial, 'getPorts'>;
};
const runtime = createNativeSerialWorkerRuntime({
  serial: workerNavigator.serial ?? null,
  post: (message) => self.postMessage(message),
});

self.onmessage = (event: MessageEvent<NativeSerialWorkerRequest>): void => {
  runtime.handle(event.data);
};
