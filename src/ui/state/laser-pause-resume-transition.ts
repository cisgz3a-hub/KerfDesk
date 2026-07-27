import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';

export type PauseResumeTransitionAction = 'pause' | 'resume';
export type PauseResumeLivenessPolicy = 'none' | 'cnc-door';

export type PauseResumeTransitionToken = {
  readonly id: symbol;
  readonly action: PauseResumeTransitionAction;
  readonly failDarkWasExternallyOwned: () => boolean;
};

export type PauseResumeTransitionState = {
  readonly token: symbol;
  readonly action: PauseResumeTransitionAction;
};

export type PauseResumeTransitionRequest = {
  readonly token: PauseResumeTransitionToken;
  readonly markFailDarkExternallyOwned: () => void;
  readonly reject: (error: Error) => void;
  readonly timeoutMessage: string;
  readonly livenessTimeoutMs: number;
  livenessTimer: ReturnType<typeof setTimeout> | null;
  maximumTimer: ReturnType<typeof setTimeout> | null;
};

export type PauseResumeTransitionRefs = {
  pauseResumeTransition?: PauseResumeTransitionRequest | null;
  pauseResumePendingWrites?: Map<symbol, PauseResumePendingWrite>;
};

export type PauseResumeTransitionOwner = {
  readonly token: PauseResumeTransitionToken;
  readonly deadline: Promise<never>;
};

type PauseResumePendingWrite = {
  writeEpoch: number;
  count: number;
  isRejected: boolean;
};

export type PauseResumeTransportFenceState = 'settling' | 'rejected';

// Pausing removes the streamer from the active-stream heartbeat's monitored
// states, so this transition owner takes over the same silence deadline.
export const PAUSE_RESUME_TRANSITION_TIMEOUT_MS = ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS;
// Fresh CNC Door progress may outlast the heartbeat, but it must not keep
// ownership forever. Thirty seconds covers the documented parking defaults
// when compiled in and stock accessory delays with margin; longer physical
// parking remains unqualified.
export const PAUSE_RESUME_TRANSITION_MAX_TIMEOUT_MS = 30_000;

export class PauseResumeTransitionError extends Error {
  public readonly failDarkAlreadyRequested: boolean;

  public constructor(message: string, failDarkAlreadyRequested: boolean) {
    super(message);
    this.name = 'PauseResumeTransitionError';
    this.failDarkAlreadyRequested = failDarkAlreadyRequested;
  }
}

/** Owns the whole physical Pause/Resume transition, including transport writes. */
export function beginPauseResumeTransition(
  refs: PauseResumeTransitionRefs,
  action: PauseResumeTransitionAction,
  timeoutMessage: string,
  timeoutMs = PAUSE_RESUME_TRANSITION_TIMEOUT_MS,
): PauseResumeTransitionOwner {
  if (refs.pauseResumeTransition != null) {
    throw new Error('Pause or Resume is already waiting for controller confirmation.');
  }
  let isFailDarkExternallyOwned = false;
  const token: PauseResumeTransitionToken = {
    id: Symbol(action),
    action,
    failDarkWasExternallyOwned: () => isFailDarkExternallyOwned,
  };
  const deadline = new Promise<never>((_resolve, reject) => {
    const request: PauseResumeTransitionRequest = {
      token,
      markFailDarkExternallyOwned: () => {
        isFailDarkExternallyOwned = true;
      },
      reject,
      timeoutMessage,
      livenessTimeoutMs: timeoutMs,
      livenessTimer: null,
      maximumTimer: null,
    };
    request.livenessTimer = scheduleLivenessTimeout(refs, request);
    request.maximumTimer = setTimeout(
      () => rejectForTimeout(refs, request),
      PAUSE_RESUME_TRANSITION_MAX_TIMEOUT_MS,
    );
    refs.pauseResumeTransition = request;
  });
  return { token, deadline };
}

export function assertPauseResumeTransitionOwner(
  refs: PauseResumeTransitionRefs,
  token: PauseResumeTransitionToken,
): void {
  if (ownsPauseResumeTransition(refs, token)) return;
  throw new PauseResumeTransitionError(
    `${transitionLabel(token.action)} no longer owns the controller transition.`,
    true,
  );
}

export function ownsPauseResumeTransition(
  refs: PauseResumeTransitionRefs,
  token: PauseResumeTransitionToken,
): boolean {
  return refs.pauseResumeTransition?.token === token;
}

export function reservePauseResumeTransportWrite(
  refs: PauseResumeTransitionRefs & { readonly writeEpoch?: number },
  token: PauseResumeTransitionToken,
): void {
  const pendingWrites = refs.pauseResumePendingWrites ?? new Map<symbol, PauseResumePendingWrite>();
  refs.pauseResumePendingWrites = pendingWrites;
  const pending = pendingWrites.get(token.id);
  if (pending === undefined) {
    pendingWrites.set(token.id, {
      writeEpoch: refs.writeEpoch ?? 0,
      count: 1,
      isRejected: false,
    });
    return;
  }
  pending.count += 1;
}

export function markPauseResumeTransportWriteRejected(
  refs: PauseResumeTransitionRefs & { readonly writeEpoch?: number },
  token: PauseResumeTransitionToken,
): void {
  const pending = refs.pauseResumePendingWrites?.get(token.id);
  if (pending === undefined) return;
  pending.writeEpoch = refs.writeEpoch ?? 0;
  pending.isRejected = true;
}

export function releasePauseResumeTransportWrite(
  refs: PauseResumeTransitionRefs,
  token: PauseResumeTransitionToken,
): void {
  const pendingWrites = refs.pauseResumePendingWrites;
  const pending = pendingWrites?.get(token.id);
  if (pending === undefined) return;
  if (pending.count > 1) {
    pending.count -= 1;
    return;
  }
  pending.count = 0;
  if (!pending.isRejected) pendingWrites?.delete(token.id);
}

export function currentPauseResumeTransportFence(
  refs: PauseResumeTransitionRefs & { readonly writeEpoch?: number },
): PauseResumeTransportFenceState | null {
  const pendingWrites = refs.pauseResumePendingWrites;
  if (pendingWrites === undefined) return null;
  const currentWriteEpoch = refs.writeEpoch ?? 0;
  for (const [tokenId, pending] of pendingWrites) {
    if (pending.writeEpoch === currentWriteEpoch) {
      return pending.isRejected ? 'rejected' : 'settling';
    }
    pendingWrites.delete(tokenId);
  }
  return null;
}

/** Refreshes silence liveness without moving the absolute transition maximum. */
export function refreshPauseResumeTransitionLiveness(
  refs: PauseResumeTransitionRefs,
  token: PauseResumeTransitionToken,
): boolean {
  const request = refs.pauseResumeTransition;
  if (request?.token !== token) return false;
  if (request.livenessTimer !== null) clearTimeout(request.livenessTimer);
  request.livenessTimer = scheduleLivenessTimeout(refs, request);
  return true;
}

export function completePauseResumeTransition(
  refs: PauseResumeTransitionRefs,
  token: PauseResumeTransitionToken,
): void {
  const request = refs.pauseResumeTransition;
  if (request?.token !== token) return;
  clearTransitionTimers(request);
  refs.pauseResumeTransition = null;
}

/** Cancels a transition because another path already owns fail-dark handling. */
export function cancelPauseResumeTransition(
  refs: PauseResumeTransitionRefs,
  message = 'Pause or Resume was cancelled by another controller operation.',
): void {
  const request = refs.pauseResumeTransition;
  if (request == null) return;
  request.markFailDarkExternallyOwned();
  rejectPauseResumeTransition(refs, request, new PauseResumeTransitionError(message, true));
}

export function failDarkWasAlreadyRequested(
  error: unknown,
  token: PauseResumeTransitionToken,
): boolean {
  return (
    token.failDarkWasExternallyOwned() ||
    (error instanceof PauseResumeTransitionError && error.failDarkAlreadyRequested)
  );
}

function rejectPauseResumeTransition(
  refs: PauseResumeTransitionRefs,
  request: PauseResumeTransitionRequest,
  error: Error,
): void {
  if (refs.pauseResumeTransition !== request) return;
  clearTransitionTimers(request);
  refs.pauseResumeTransition = null;
  request.reject(error);
}

function scheduleLivenessTimeout(
  refs: PauseResumeTransitionRefs,
  request: PauseResumeTransitionRequest,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => rejectForTimeout(refs, request), request.livenessTimeoutMs);
}

function rejectForTimeout(
  refs: PauseResumeTransitionRefs,
  request: PauseResumeTransitionRequest,
): void {
  rejectPauseResumeTransition(
    refs,
    request,
    new PauseResumeTransitionError(request.timeoutMessage, false),
  );
}

function clearTransitionTimers(request: PauseResumeTransitionRequest): void {
  if (request.livenessTimer !== null) clearTimeout(request.livenessTimer);
  if (request.maximumTimer !== null) clearTimeout(request.maximumTimer);
  request.livenessTimer = null;
  request.maximumTimer = null;
}

function transitionLabel(action: PauseResumeTransitionAction): string {
  return action === 'pause' ? 'Pause' : 'Resume';
}
