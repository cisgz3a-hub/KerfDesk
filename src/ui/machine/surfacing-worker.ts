/// <reference lib="webworker" />
import type { SurfacingWorkerRequest, SurfacingWorkerResponse } from './surfacing-worker-protocol';
import { prepareSurfacingStream } from './surfacing-worker-runtime';

let chunks: Iterator<string> | null = null;
self.onmessage = (event: MessageEvent<SurfacingWorkerRequest>): void => {
  let response: SurfacingWorkerResponse;
  try {
    if (event.data.kind === 'prepare') {
      const session = prepareSurfacingStream(event.data.input);
      chunks = session.chunks;
      response = { kind: 'ready', prepared: session.prepared };
    } else {
      if (chunks === null) throw new Error('No prepared surfacing program.');
      const next = chunks.next();
      response = { kind: 'chunk', text: next.value ?? '', done: next.done === true };
    }
  } catch (error) {
    response = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
