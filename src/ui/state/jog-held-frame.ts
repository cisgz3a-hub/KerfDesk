// jog-held-frame — a completed Frame survives a clean app-owned XY jog when
// the job is placed by a fixed origin (ADR-565 Amendment 1, user annoyance
// audit A2-D-2).
//
// Absolute, User Origin and Verified Origin programs are written in work
// coordinates, so moving the head does not move the job. The Frame is still
// taken out of the store for the whole move: Start stays disabled, and every
// existing invalidation keeps acting on the live proof exactly as before. The
// jog's motion operation carries the Frame instead, and only that operation's
// own clean settlement at Idle puts it back, rebased on the new head position.
// A Current Position job, a Z or rotary-axis move, a rotary job, an alarm, a
// rejected line, a failed Cancel, a pendant takeover and any origin, session
// or artwork change all leave the Frame expired, as they always did.

import { rotaryAppliesTo } from '../../core/job';
import { framedRunDriftReason } from '../laser/framed-run-readiness';
import { framedRunControllerSnapshot, type FramedRunPermit } from './framed-run';
import {
  withoutHeldJogFrame,
  type HeldJogFrame,
  type LaserMotionOperation,
} from './laser-motion-operation';
import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

type JogAxes = { readonly dz?: number; readonly da?: number };

type JogStartPatch = Pick<
  LaserState,
  'motionOperation' | 'frameVerification' | 'framedRun' | 'frameTrace'
> &
  Partial<Pick<LaserState, 'completedFrame' | 'completedFrameRunOwner'>>;

const movesOnlyXy = (axes: JogAxes): boolean => (axes.dz ?? 0) === 0 && (axes.da ?? 0) === 0;

/** The store patch that installs a jog's motion owner. The live Frame proof is
 * cleared as for every deliberate head move; an eligible Frame rides on the
 * operation until the move ends. A `voidsFrame` jog, such as a rotary test
 * turn, never keeps one. */
export function jogStartPatch(
  state: LaserState,
  operation: LaserMotionOperation,
  axes: JogAxes,
  options: { readonly voidsFrame?: boolean } = {},
): JogStartPatch {
  const cleared = { frameVerification: null, framedRun: null, frameTrace: null };
  const frame = options.voidsFrame === true ? null : frameHeldThroughJog(state, axes);
  if (frame === null) return { motionOperation: operation, ...cleared };
  return {
    motionOperation: { ...operation, heldFrame: { frame, armed: state.framedRun === frame } },
    ...cleared,
    completedFrame: null,
    completedFrameRunOwner: null,
  };
}

/** The completed Frame this jog may set aside: an ordinary, still-current
 * Frame of a fixed-placement flat job, and a move in X and Y only. */
function frameHeldThroughJog(state: LaserState, axes: JogAxes): FramedRunPermit | null {
  const frame = state.completedFrame ?? null;
  if (frame === null || !movesOnlyXy(axes)) return null;
  if (!placedByFixedOrigin(frame) || !soleLiveProof(state, frame)) return null;
  // Strict: the Frame must still hold where the head stands before it moves.
  return framedRunDriftReason(frame, undefined, state) === null ? frame : null;
}

/** An ordinary flat job whose program does not depend on the head position. */
function placedByFixedOrigin(frame: FramedRunPermit): boolean {
  const candidate = frame.candidate;
  return (
    candidate.authorizationContext === undefined &&
    candidate.preparedStart.jobOrigin?.startFrom !== 'current-position' &&
    // A roller turns the work under the head: a jog there is not a plain move.
    !rotaryAppliesTo(candidate.project.device, candidate.project.machine)
  );
}

/** The store's whole Frame proof is this Frame, and no Start is claiming it. */
function soleLiveProof(state: LaserState, frame: FramedRunPermit): boolean {
  return (
    (state.framedRun === null || state.framedRun === frame) &&
    state.frameVerification === frame.candidate.frameVerification &&
    (state.completedFrameRunOwner ?? null) === null &&
    state.framedRunStartClaim === null
  );
}

/** A step press that joined a running jog (ADR-674) moves with that jog. One
 * that turns Z or a rotary axis ends the Frame the jog was carrying. */
export function queuedStepHeldFramePatch(
  state: LaserState,
  axes: JogAxes,
): Partial<Pick<LaserState, 'motionOperation'>> {
  const operation = state.motionOperation;
  return operation?.heldFrame === undefined || movesOnlyXy(axes)
    ? {}
    : { motionOperation: withoutHeldJogFrame(operation) };
}

/** True while nothing but the head's X and Y has changed since the Frame.
 * `state` is the store as the jog's settling Idle report leaves it. */
export function heldJogFrameStillCurrent(frame: FramedRunPermit, state: LaserState): boolean {
  return (
    state.connection.kind === 'connected' &&
    !heldJogFrameActivityInvalidates(state) &&
    framedRunDriftReason(frame, undefined, state, {
      ignoreControllerStatusState: true,
      ignoreControllerXyPosition: true,
    }) === null
  );
}

/** Activity that voids a Frame held through a jog, whatever the jog does. */
export function heldJogFrameActivityInvalidates(state: LaserState): boolean {
  return (
    state.autofocusBusy ||
    state.alarmCode !== null ||
    state.mpgActive === true ||
    isActiveJob(state.streamer)
  );
}

type HeldFrameCompletion = {
  readonly operation: LaserState['motionOperation'];
  readonly observedOperation: LaserState['motionOperation'];
  readonly queuedFrameDispatch: unknown;
  readonly state: LaserState;
  readonly positionPatch: Partial<LaserState>;
};

/** Called for the status report that settles a motion operation. Returns the
 * held Frame, rebased on the reported head position, when the jog ended
 * cleanly at Idle and nothing the Frame binds changed; otherwise nothing, and
 * the Frame is gone with the operation. */
export function heldJogFrameCompletionPatch(
  args: HeldFrameCompletion,
): Partial<
  Pick<LaserState, 'framedRun' | 'completedFrame' | 'completedFrameRunOwner' | 'frameVerification'>
> {
  const held = cleanlySettledHeldFrame(args);
  if (held === null) return {};
  const settled: LaserState = { ...args.state, ...args.positionPatch };
  if (
    settled.statusReport?.state !== 'Idle' ||
    // Something else already holds proof: never replace or resurrect over it.
    settled.framedRun !== null ||
    (settled.completedFrame ?? null) !== null ||
    (settled.frameTrace ?? null) !== null ||
    settled.frameVerification !== null ||
    !heldJogFrameStillCurrent(held.frame, settled)
  )
    return {};
  // As after an owned run (settledCompletedFramePatch): the footprint stays and
  // the next approach leaves from the head position reported now.
  const frame: FramedRunPermit = {
    ...held.frame,
    controller: framedRunControllerSnapshot(settled),
  };
  return {
    completedFrame: frame,
    completedFrameRunOwner: null,
    framedRun: held.armed ? frame : null,
    frameVerification: frame.candidate.frameVerification,
  };
}

function cleanlySettledHeldFrame(args: HeldFrameCompletion): HeldJogFrame | null {
  const operation = args.operation;
  if (
    operation?.kind !== 'jog' ||
    operation.heldFrame === undefined ||
    args.observedOperation !== null ||
    args.queuedFrameDispatch !== null ||
    operation.interruptedByMpg === true ||
    operation.mpgInterruptionId !== undefined
  )
    return null;
  const held = operation.heldFrame;
  if (operation.cancelRequested !== true) return held;
  // A cancelled jog returns its Frame only through the operator Cancel that
  // stopped it while healthy, once that same attempt has settled the motion.
  return held.releaseAttemptId !== undefined &&
    held.releaseAttemptId === operation.cancelAttemptId &&
    operation.automaticReleaseAttempts === undefined
    ? held
    : null;
}

/** What a Cancel leaves of the held Frame. An operator Cancel of a jog that
 * was still healthy (a hold-to-jog release, Stop motion) binds the Frame to
 * its own attempt. A jog already cancelled by a failure, and every automatic
 * release, loses it. */
export function heldFrameThroughCancel(
  operation: LaserMotionOperation,
  attemptId: symbol,
  automaticRelease: boolean,
): HeldJogFrame | undefined {
  const held = operation.heldFrame;
  if (held === undefined || automaticRelease || operation.kind !== 'jog') return undefined;
  const healthy = operation.cancelRequested !== true;
  const sameRelease =
    held.releaseAttemptId !== undefined &&
    held.releaseAttemptId === operation.cancelAttemptId &&
    operation.automaticReleaseAttempts === undefined;
  return healthy || sameRelease ? { ...held, releaseAttemptId: attemptId } : undefined;
}
