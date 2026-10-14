import { PackedToolpathSteps } from '../../core/job/packed-toolpath-steps';
import type { ActiveRequest } from './preparation-request';
import type { PreparationTransferResponse } from './preparation-transfer-protocol';
import type { PreparationWorkerResponse } from './preparation-worker-protocol';

type SettledResponse = Exclude<
  PreparationWorkerResponse,
  PreparationTransferResponse | { readonly kind: 'progress' | 'estimate-ready' }
>;

/** Decode a terminal response after the client has retired its worker heap. */
export function settleWorkerResponse(settled: ActiveRequest, response: SettledResponse): void {
  if (response.kind === 'error') {
    settled.reject(new Error(response.message));
    return;
  }
  if (response.kind === 'estimate') {
    settled.resolve({ estimate: response.estimate });
    return;
  }
  if (response.kind === 'packed') {
    // Transferred route buffers stay packed on the main thread.
    const { kind: _kind, id: _id, toolpath, packed, ...prepared } = response;
    settled.resolve({
      ...prepared,
      toolpath: { ...toolpath, steps: new PackedToolpathSteps(packed) },
    });
    return;
  }
  settled.resolve({
    toolpath: response.toolpath,
    estimate: response.estimate,
    ...(response.jobOriginOffset === undefined
      ? {}
      : { jobOriginOffset: response.jobOriginOffset }),
  });
}

export function isTransferResponse(
  response: PreparationWorkerResponse,
): response is PreparationTransferResponse {
  return (
    response.kind === 'transfer-start' ||
    response.kind === 'transfer-chunk' ||
    response.kind === 'transfer-complete'
  );
}
