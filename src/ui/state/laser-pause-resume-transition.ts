import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';

export type PauseResumeTransitionAction = 'pause' | 'resume';

export type PauseResumeTransitionToken = {
  readonly id: symbol;
  readonly action: PauseResumeTransitionAction;
  readonly failDarkWasExternallyOwned: () => boolean;
};

export type PauseResumeTransitionRequest = {
  readonly token: PauseResumeTransitionToken;
  readonly markFailDarkExternallyOwned: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export type PauseResumeTransitionRefs = {
  pauseResumeTransition?: PauseResumeTransitionRequest | null;
};

export type PauseResumeTransitionOwner = {
  readonly token: PauseResumeTransitionToken;
  readonly deadline: Promise<never>;
};

// Pausing removes the streamer from the active-stream heartbeat's monitored
// states, so this transition owner must take over with no weaker deadline.
export const PAUSE_RESUME_TRANSITION_TIMEOUT_MS = ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS;

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
  let request: PauseResumeTransitionRequest;
  const deadline = new Promise<never>((_resolve, reject) => {
    request = {
      token,
      markFailDarkExternallyOwned: () => {
        isFailDarkExternallyOwned = true;
      },
      reject,
      timer: setTimeout(() => {
        rejectPauseResumeTransition(
          refs,
          request,
          new PauseResumeTransitionError(timeoutMessage, false),
        );
      }, timeoutMs),
    };
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

export function completePauseResumeTransition(
  refs: PauseResumeTransitionRefs,
  token: PauseResumeTransitionToken,
): void {
  const request = refs.pauseResumeTransition;
  if (request?.token !== token) return;
  clearTimeout(request.timer);
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
  clearTimeout(request.timer);
  refs.pauseResumeTransition = null;
  request.reject(error);
}

function transitionLabel(action: PauseResumeTransitionAction): string {
  return action === 'pause' ? 'Pause' : 'Resume';
}
