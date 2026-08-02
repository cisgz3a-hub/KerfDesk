import type {
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from '../../ui/box/box-generation-worker-protocol';

/**
 * Test-only Worker double that records every request and answers only when the
 * test calls respond(). Instances are tracked statically so tests can assert
 * how many workers the client actually spawned — reset the array per test.
 */
export class ManualBoxGenerationWorker {
  static instances: ManualBoxGenerationWorker[] = [];
  onmessage: ((event: MessageEvent<BoxGenerationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: BoxGenerationWorkerRequest[] = [];
  isTerminated = false;

  constructor() {
    ManualBoxGenerationWorker.instances.push(this);
  }

  postMessage(request: BoxGenerationWorkerRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.isTerminated = true;
  }

  respond(response: BoxGenerationWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BoxGenerationWorkerResponse>);
  }
}
