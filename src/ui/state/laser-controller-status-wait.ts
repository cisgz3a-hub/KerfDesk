import type { StatusReport } from '../../core/controllers/grbl';

export type ControllerStatusStamp = {
  readonly sessionEpoch: number;
  readonly sequence: number;
};

type ControllerStatusWaitRequest = {
  readonly sessionEpoch: number;
  readonly afterSequence: number;
  readonly accept: (report: StatusReport) => boolean;
  readonly resolve: (report: StatusReport) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export type ControllerStatusWaitRefs = {
  controllerStatusWait?: ControllerStatusWaitRequest | null;
};

type FreshControllerStatusOptions = {
  readonly after: ControllerStatusStamp;
  readonly accept: (report: StatusReport) => boolean;
  readonly timeoutMs?: number;
  readonly timeoutMessage: string;
};

const DEFAULT_STATUS_TIMEOUT_MS = 8_000;

export function waitForFreshControllerStatus(
  refs: ControllerStatusWaitRefs,
  options: FreshControllerStatusOptions,
): Promise<StatusReport> {
  if (refs.controllerStatusWait != null) {
    return Promise.reject(new Error('A controller status confirmation is already active.'));
  }
  return new Promise((resolve, reject) => {
    const request: ControllerStatusWaitRequest = {
      sessionEpoch: options.after.sessionEpoch,
      afterSequence: options.after.sequence,
      accept: options.accept,
      resolve,
      reject,
      timer: setTimeout(() => {
        finishControllerStatusWait(refs, request, 'reject', options.timeoutMessage);
      }, options.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS),
    };
    refs.controllerStatusWait = request;
  });
}

export function observeFreshControllerStatus(
  refs: ControllerStatusWaitRefs,
  stamp: ControllerStatusStamp,
  report: StatusReport,
): void {
  const request = refs.controllerStatusWait;
  if (request == null) return;
  if (stamp.sessionEpoch !== request.sessionEpoch) {
    finishControllerStatusWait(refs, request, 'reject', 'Controller session changed.');
    return;
  }
  if (stamp.sequence <= request.afterSequence) return;
  if (report.state === 'Alarm' || report.state === 'Sleep') {
    finishControllerStatusWait(refs, request, 'reject', `Controller entered ${report.state}.`);
    return;
  }
  if (request.accept(report))
    finishControllerStatusWait(refs, request, 'resolve', undefined, report);
}

export function cancelFreshControllerStatusWait(
  refs: ControllerStatusWaitRefs,
  message = 'Controller status confirmation was cancelled.',
): void {
  const request = refs.controllerStatusWait;
  if (request != null) finishControllerStatusWait(refs, request, 'reject', message);
}

function finishControllerStatusWait(
  refs: ControllerStatusWaitRefs,
  request: ControllerStatusWaitRequest,
  mode: 'resolve' | 'reject',
  message?: string,
  report?: StatusReport,
): void {
  if (refs.controllerStatusWait !== request) return;
  refs.controllerStatusWait = null;
  clearTimeout(request.timer);
  if (mode === 'resolve' && report !== undefined) request.resolve(report);
  else request.reject(new Error(message ?? 'Controller status was not confirmed.'));
}
