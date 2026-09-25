// laser-controller-reset-wait — waits for the boot banner a commanded reset
// produces. Split from laser-interactive-command when that module reached the
// 400-line cap; laser-interactive-command re-exports it for its callers.

const DEFAULT_RESET_TIMEOUT_MS = 8_000;

type ControllerResetWaitRequest = {
  readonly expectedEpoch: number;
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export type ControllerResetWaitRefs = {
  controllerResetWait?: ControllerResetWaitRequest | null;
  writeEpoch?: number;
};

export function waitForControllerResetBoundary(
  refs: ControllerResetWaitRefs,
  expectedEpoch: number,
  timeoutMs = DEFAULT_RESET_TIMEOUT_MS,
): Promise<void> {
  if (refs.controllerResetWait != null) {
    return Promise.reject(new Error('A controller reset-boundary wait is already active.'));
  }
  return new Promise((resolve, reject) => {
    const request: ControllerResetWaitRequest = {
      expectedEpoch,
      resolve,
      reject,
      timer: setTimeout(() => {
        finishResetWait(refs, request, 'reject', 'Timed out waiting for controller reboot banner.');
      }, timeoutMs),
    };
    refs.controllerResetWait = request;
  });
}

export function observeControllerResetBoundary(refs: ControllerResetWaitRefs): void {
  const request = refs.controllerResetWait;
  if (request == null) return;
  if ((refs.writeEpoch ?? 0) <= request.expectedEpoch) return;
  finishResetWait(refs, request, 'resolve');
}

export function cancelControllerResetWait(refs: ControllerResetWaitRefs, message: string): void {
  const resetWait = refs.controllerResetWait;
  if (resetWait != null) finishResetWait(refs, resetWait, 'reject', message);
}

function finishResetWait(
  refs: ControllerResetWaitRefs,
  request: ControllerResetWaitRequest,
  mode: 'resolve' | 'reject',
  message?: string,
): void {
  if (refs.controllerResetWait !== request) return;
  refs.controllerResetWait = null;
  clearTimeout(request.timer);
  if (mode === 'resolve') request.resolve();
  else request.reject(new Error(message ?? 'Controller reboot boundary was not observed.'));
}
