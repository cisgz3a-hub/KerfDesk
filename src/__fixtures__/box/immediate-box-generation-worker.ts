import { runBoxGenerationRequest } from '../../ui/box/box-generation-worker-runtime';
import type {
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from '../../ui/box/box-generation-worker-protocol';

/** Test-only Worker double that completes the real pure request on a microtask. */
export class ImmediateBoxGenerationWorker {
  onmessage: ((event: MessageEvent<BoxGenerationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  isTerminated = false;

  postMessage(request: BoxGenerationWorkerRequest): void {
    queueMicrotask(() => {
      if (this.isTerminated) return;
      this.onmessage?.({
        data: runBoxGenerationRequest(request),
      } as MessageEvent<BoxGenerationWorkerResponse>);
    });
  }

  terminate(): void {
    this.isTerminated = true;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }
}
