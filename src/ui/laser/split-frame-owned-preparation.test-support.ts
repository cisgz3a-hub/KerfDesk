import { expect, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { StatusReport } from '../../core/controllers/grbl';
import { framedRunCompletionIssue, type FrameTraceCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { completeTraceForTest, dispatchedFrameOperation } from './split-frame.test-support';
import { runFrameNow } from './use-frame-action';

/** Real preparation/client/owner; only the worker transport and physical motion
 * are simulated. The worker holds its exact result after reporting the outline. */
export class HeldFrameWorker {
  static instances: HeldFrameWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  response: OutputPreparationResponse | null = null;
  requestId = 0;

  constructor() {
    HeldFrameWorker.instances.push(this);
  }

  postMessage(value: OutputPreparationEnvelope): void {
    if (isCanvasCompilationBridgeConnection(value)) return;
    this.requestId = value.requestId;
    void prepareOutputRequestForTest(value.request, {
      onFrameBounds: (frameBounds) => {
        this.emit({ requestId: this.requestId, frameBounds });
      },
    }).then((response) => {
      this.response = response;
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  release(): void {
    if (this.response === null) throw new Error('The exact fixture program is not ready.');
    // Even a late delivery from a terminated worker must not reach its caller.
    this.emit({ requestId: this.requestId, response: this.response });
  }

  private emit(data: OutputPreparationResult): void {
    this.onmessage?.({ data } as MessageEvent<OutputPreparationResult>);
  }
}

export function reportFrameStatus(report: StatusReport): void {
  useLaserStore.setState((state) => ({
    statusReport: report,
    statusSequence: state.statusSequence + 1,
  }));
}

export async function startHeldFrame(beforeDispatch?: () => void) {
  const originalStatus = useLaserStore.getState().statusReport;
  if (originalStatus === null) throw new Error('The fixture needs an initial position.');
  let candidate: FrameTraceCandidate | undefined;
  useLaserStore.setState({
    traceFrame: vi.fn(async (_bounds, _feed, next) => {
      candidate = next;
      await Promise.resolve();
      beforeDispatch?.();
      // The real action clears previous proofs before assigning the operation.
      useLaserStore.setState({ framedRun: null, frameTrace: null, frameVerification: null });
      dispatchedFrameOperation(next);
    }),
  });
  const outcome = runFrameNow();
  await vi.waitFor(() => {
    expect(candidate).toBeDefined();
    expect(HeldFrameWorker.instances.at(-1)?.response).not.toBeNull();
  });
  const worker = HeldFrameWorker.instances.at(-1);
  if (candidate === undefined || worker === undefined) throw new Error('Frame was not dispatched.');
  const traced = candidate;
  return {
    outcome,
    candidate: traced,
    originalStatus,
    worker,
    complete: (report = originalStatus) => {
      reportFrameStatus(report);
      expect(framedRunCompletionIssue(traced, useLaserStore.getState())).toBeNull();
      completeTraceForTest(traced);
    },
  };
}
