import { onSchedulePollTimeAt, type StatusPollScheduleRefs } from './laser-status-poll-schedule';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';

export type PauseResumeTransitionAction = 'pause' | 'resume';
// 'cnc-door': settled writes and every fresh Door progress report refresh the
// silence deadline. 'door-restore': only fresh Resume restore reports do (the
// laser path, where the beam stays dark until the cycle restarts).
export type PauseResumeLivenessPolicy = 'none' | 'cnc-door' | 'door-restore';

export type PauseResumeTransitionToken = {
  readonly id: symbol;
  readonly action: PauseResumeTransitionAction;
  readonly failDarkWasExternallyOwned: () => boolean;
};

export type PauseResumeTransitionState = {
  readonly token: symbol;
  readonly action: PauseResumeTransitionAction;
};

/** Whether a Hold or Door is KerfDesk's own: the stream is paused, a Pause or
 * Resume is in flight, or a CNC Pause and lift runs (ADR-333 Amendment 1). */
export function kerfDeskOwnsHold(state: {
  readonly streamer: { readonly status: string } | null;
  readonly pauseResumeTransition: PauseResumeTransitionState | null;
  readonly cncPauseLift?: unknown;
}): boolean {
  return (
    state.streamer?.status === 'paused' ||
    state.pauseResumeTransition !== null ||
    (state.cncPauseLift ?? null) !== null
  );
}

/** A laser Resume that left grblHAL Idle at the end of a job, which may still
 * hold the paused move's tail (ADR-684; held-resume-tail.ts reads it). */
export type HeldResumeTail = {
  readonly sessionEpoch: number;
  /** Machine position when Resume confirmed; null when it was unknown. */
  readonly machinePosition: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** The job's streamer epoch; a later job has a new one and runs the tail.
   *  Optional so hand-built test states stay valid. */
  readonly streamerEpoch?: number;
};

/** The laser store's Pause/Resume fields. */
export type PauseResumeStoreState = {
  readonly pauseResumeTransition: PauseResumeTransitionState | null;
  /** Read through currentHeldResumeTail (ADR-684). */
  readonly heldResumeTail?: HeldResumeTail | null;
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

export type PauseResumeTransitionRefs = StatusPollScheduleRefs & {
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
  /** The silence or absolute deadline expired, as opposed to losing ownership. */
  public readonly deadlineExpired: boolean;

  public constructor(message: string, failDarkAlreadyRequested: boolean, deadlineExpired = false) {
    super(message);
    this.name = 'PauseResumeTransitionError';
    this.failDarkAlreadyRequested = failDarkAlreadyRequested;
    this.deadlineExpired = deadlineExpired;
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

/** A Pause or Resume is still settling on the controller. */
export function hasPauseResumeTransition(refs: PauseResumeTransitionRefs): boolean {
  return refs.pauseResumeTransition != null;
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

export function hasCurrentPauseResumeTransportFence(
  refs: PauseResumeTransitionRefs & { readonly writeEpoch?: number },
  token: PauseResumeTransitionToken,
): boolean {
  const pendingWrites = refs.pauseResumePendingWrites;
  const pending = pendingWrites?.get(token.id);
  if (pending === undefined) return false;
  if (pending.writeEpoch === (refs.writeEpoch ?? 0)) return true;
  pendingWrites?.delete(token.id);
  return false;
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

export function isPauseResumeDeadlineError(error: unknown): boolean {
  return error instanceof PauseResumeTransitionError && error.deadlineExpired;
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

// The silence deadline counts only time the status poll ran on schedule, as
// the heartbeat does (ADR-356 Amendment 2). While the page is stalled no query
// is written, and a reply that did arrive may wait behind this timer, so a
// stall that ends past a wall-clock deadline is not the controller's silence.
// After a stall the overdue poll tick runs first, since it fell due earlier; a
// poll that has not ticked since arming is not running, and the deadline keeps
// its wall-clock meaning.
function scheduleLivenessTimeout(
  refs: PauseResumeTransitionRefs,
  request: PauseResumeTransitionRequest,
): ReturnType<typeof setTimeout> {
  const armedAt = Date.now();
  const armedOnSchedule = onSchedulePollTimeAt(refs.statusPollSchedule, armedAt);
  const check = (): void => {
    const now = Date.now();
    const schedule = refs.statusPollSchedule;
    const onSchedule =
      schedule != null && schedule.lastTickAt >= armedAt
        ? onSchedulePollTimeAt(schedule, now)
        : null;
    const elapsed =
      armedOnSchedule === null || onSchedule === null
        ? now - armedAt
        : onSchedule - armedOnSchedule;
    const remaining = request.livenessTimeoutMs - elapsed;
    if (remaining <= 0) rejectForTimeout(refs, request);
    else request.livenessTimer = setTimeout(check, Math.min(remaining, request.livenessTimeoutMs));
  };
  return setTimeout(check, request.livenessTimeoutMs);
}

function rejectForTimeout(
  refs: PauseResumeTransitionRefs,
  request: PauseResumeTransitionRequest,
): void {
  rejectPauseResumeTransition(
    refs,
    request,
    new PauseResumeTransitionError(request.timeoutMessage, false, true),
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
