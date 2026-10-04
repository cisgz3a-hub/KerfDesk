import type { MachineExecutionOwner } from '../state/machine-execution-owner';

export type FrameCallerOptions = MachineExecutionOwner & {
  /** Remote callers cannot accept native Home/Unlock/Set-Origin/Zero-Z offers. */
  readonly interactiveSetup?: boolean;
  readonly joinExisting?: boolean;
};

export function linkFrameAbort(signal: AbortSignal | undefined, abort: () => void): () => void {
  if (signal?.aborted === true) abort();
  signal?.addEventListener('abort', abort, { once: true });
  return () => signal?.removeEventListener('abort', abort);
}

export function frameExecutionOwner(
  options: FrameCallerOptions,
): MachineExecutionOwner | undefined {
  return options.signal === undefined &&
    options.assertCurrent === undefined &&
    options.onMotionOwner === undefined &&
    options.onDispatch === undefined
    ? undefined
    : options;
}
