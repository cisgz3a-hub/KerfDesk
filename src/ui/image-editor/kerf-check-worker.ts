/// <reference lib="webworker" />

import { computeKerfOutputParity } from './editor-kerf-output-parity';
import type { KerfCheckWorkerRequest, KerfCheckWorkerResponse } from './kerf-check-worker-protocol';

self.onmessage = (event: MessageEvent<KerfCheckWorkerRequest>): void => {
  // The worker is shared across checks, so every response carries the id of the
  // request that produced it; the client drops ids it no longer tracks.
  const { id } = event.data;
  try {
    const parity = computeKerfOutputParity(event.data);
    const response: KerfCheckWorkerResponse = { kind: 'ok', id, parity };
    const maskBuffer = parity?.thickenCandidate?.removed.mask?.alpha.buffer;
    const sValuesBuffer = parity?.thickenCandidate?.group.sValues.buffer;
    const transfer = [maskBuffer, sValuesBuffer].filter(
      (buffer, index, buffers): buffer is ArrayBuffer =>
        buffer instanceof ArrayBuffer && buffers.indexOf(buffer) === index,
    );
    self.postMessage(response, transfer);
  } catch (error) {
    const response: KerfCheckWorkerResponse = {
      kind: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
