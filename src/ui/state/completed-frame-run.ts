import {
  framedRunControllerSnapshot,
  framedRunStartHandoffIssue,
  type FramedRunPermit,
} from './framed-run';
import type { LaserState } from './laser-store';

export type CompletedFrameRunOwner = {
  readonly frame: FramedRunPermit;
  readonly streamerEpoch: number;
  readonly runId: string | null;
};

/** Only the execution that consumed this proof's exact permit may move the
 * head without revoking the reusable footprint. A replacement stream cannot
 * adopt it, even when its source or final coordinates happen to match. */
export function completedFrameRunIsOwned(state: LaserState): boolean {
  const owner = state.completedFrameRunOwner;
  return (
    owner !== null &&
    owner !== undefined &&
    state.streamer !== null &&
    owner.frame === state.completedFrame &&
    owner.streamerEpoch === state.streamerEpoch &&
    owner.runId === state.activeRunId
  );
}

/** Called only by successful, owned post-job terminal settlement. Absolute
 * placement keeps its footprint and observes the new head for the next
 * approach. Current Position keeps its captured physical placement. */
export function settledCompletedFramePatch(
  state: LaserState,
): Partial<Pick<LaserState, 'completedFrame' | 'completedFrameRunOwner' | 'frameVerification'>> {
  const frame = state.completedFrame;
  if (frame === null || frame === undefined || !completedFrameRunIsOwned(state)) return {};
  const positioned = frame.candidate.preparedStart.jobOrigin?.startFrom === 'current-position';
  if (
    !sameSpatialControllerAfterRun(frame, state) ||
    (positioned && framedRunStartHandoffIssue(frame, state) !== null)
  ) {
    return { completedFrame: null, completedFrameRunOwner: null, frameVerification: null };
  }
  return {
    completedFrame: { ...frame, controller: framedRunControllerSnapshot(state) },
    completedFrameRunOwner: null,
  };
}

export type StashedFrameProof = Pick<
  LaserState,
  'framedRun' | 'frameVerification' | 'completedFrame'
>;

/** A verified, beam-off positioning-light move keeps an Absolute footprint
 * (ADR-605): it observes the new head exactly as owned-run settlement does.
 * Current Position, transient permits, a split trace awaiting its program, or
 * any newer Frame evidence stay void. */
export function rebasedLightMoveFramePatch(
  stash: StashedFrameProof,
  state: LaserState,
): Partial<
  Pick<LaserState, 'framedRun' | 'completedFrame' | 'completedFrameRunOwner' | 'frameVerification'>
> {
  const frame = stash.completedFrame ?? null;
  if (
    frame === null ||
    frame.candidate.authorizationContext !== undefined ||
    frame.candidate.preparedStart.jobOrigin?.startFrom === 'current-position' ||
    state.framedRun !== null ||
    (state.completedFrame ?? null) !== null ||
    !sameSpatialControllerAfterRun(frame, state)
  )
    return {};
  const rebased: FramedRunPermit = { ...frame, controller: framedRunControllerSnapshot(state) };
  return {
    completedFrame: rebased,
    completedFrameRunOwner: null,
    framedRun: stash.framedRun === frame ? rebased : null,
    frameVerification: stash.frameVerification,
  };
}

function sameSpatialControllerAfterRun(frame: FramedRunPermit, state: LaserState): boolean {
  return (
    state.connection.kind === 'connected' &&
    state.statusReport?.state === 'Idle' &&
    state.alarmCode === null &&
    state.workZReferenceEpoch === frame.controller.workZReferenceEpoch &&
    state.workZZeroEvidence === frame.controller.workZZeroEvidence &&
    framedRunStartHandoffIssue(frame, {
      ...state,
      statusReport: frame.controller.statusReport,
    }) === null
  );
}
