import { describe, expect, it } from 'vitest';
import {
  BOUNDED_COMPILATION_BRIDGE_CHANNEL,
  type BoundedCompilationBridgePort,
  type BoundedCompilationBridgeRequest,
  type BoundedCompilationBridgeResponse,
} from './bounded-compilation-bridge-protocol';
import { BoundedCompilationMainBridge } from './bounded-compilation-main-bridge';
import type {
  BoundedCompilationWorkerLike,
  BoundedCompilationWorkerRequest,
} from './bounded-compilation-worker-pool-protocol';

type Payload = { readonly value: string };
type Result = { readonly buffer: ArrayBuffer };

class TransferRecordingPort implements BoundedCompilationBridgePort {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  peer: TransferRecordingPort | null = null;
  readonly transferLists: Transferable[][] = [];

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.transferLists.push(transfer);
    this.peer?.onmessage?.({ data: message });
  }

  start(): void {
    return;
  }

  close(): void {
    this.onmessage = null;
    this.onmessageerror = null;
  }
}

class ImmediateWorker implements BoundedCompilationWorkerLike<Payload> {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;

  constructor(private readonly buffer: ArrayBuffer) {}

  postMessage(request: BoundedCompilationWorkerRequest<Payload>): void {
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          kind: 'ok',
          submissionId: request.submissionId,
          jobId: request.jobId,
          taskId: request.taskId,
          result: { buffer: this.buffer },
        },
      }),
    );
  }

  terminate(): void {
    return;
  }
}

describe('BoundedCompilationMainBridge result transfers', () => {
  it('forwards configured result buffers to the outer Worker port by ownership', async () => {
    const buffer = new ArrayBuffer(32);
    const bridge = new BoundedCompilationMainBridge<Payload, Result>({
      concurrency: 2,
      maxSources: 1,
      maxActiveJobs: 1,
      createWorker: () => new ImmediateWorker(buffer),
      resultTransferables: (result) => [result.buffer],
    });
    const [mainPort, clientPort] = portPair();
    const detach = bridge.attach(mainPort);
    const result = new Promise<BoundedCompilationBridgeResponse<Result>>((resolve) => {
      clientPort.onmessage = (event) => {
        const response = event.data as BoundedCompilationBridgeResponse<Result>;
        if (response.kind === 'result') resolve(response);
      };
    });

    clientPort.postMessage({
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'submit',
      requestId: 1,
      jobId: 'transfer-job',
      tasks: [{ taskId: 'surface', payload: { value: 'surface' } }],
    } satisfies BoundedCompilationBridgeRequest<Payload>);

    await expect(result).resolves.toMatchObject({ kind: 'result', results: [{ buffer }] });
    expect(mainPort.transferLists.some((transfer) => transfer.includes(buffer))).toBe(true);
    detach();
    bridge.dispose();
  });

  it('returns a correlated error when result-transfer discovery fails', async () => {
    const buffer = new ArrayBuffer(32);
    const bridge = new BoundedCompilationMainBridge<Payload, Result>({
      concurrency: 2,
      maxSources: 1,
      maxActiveJobs: 1,
      createWorker: () => new ImmediateWorker(buffer),
      resultTransferables: () => {
        throw new Error('invalid transferable result');
      },
    });
    const [mainPort, clientPort] = portPair();
    const detach = bridge.attach(mainPort);
    const response = new Promise<BoundedCompilationBridgeResponse<Result>>((resolve) => {
      clientPort.onmessage = (event) => {
        const message = event.data as BoundedCompilationBridgeResponse<Result>;
        if (message.kind === 'error') resolve(message);
      };
    });

    clientPort.postMessage({
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'submit',
      requestId: 1,
      jobId: 'transfer-error-job',
      tasks: [{ taskId: 'surface', payload: { value: 'surface' } }],
    } satisfies BoundedCompilationBridgeRequest<Payload>);

    await expect(response).resolves.toMatchObject({
      kind: 'error',
      requestId: 1,
      jobId: 'transfer-error-job',
      message: 'invalid transferable result',
    });
    detach();
    bridge.dispose();
  });
});

function portPair(): [TransferRecordingPort, TransferRecordingPort] {
  const first = new TransferRecordingPort();
  const second = new TransferRecordingPort();
  first.peer = second;
  second.peer = first;
  return [first, second];
}
