import type { GrblState, StatusReport } from '../../core/controllers/grbl';
import { frameStatusFailureMessage } from './frame-status-failure';
import { createFramedRunPermit, framedRunCompletionIssue } from './framed-run';
import {
  applyMotionTerminalAckFence,
  observeMotionStatus,
  takeNextMotionLine,
} from './laser-motion-operation';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

export type FrameMotionObservation = {
  readonly observed: LaserState['motionOperation'];
  readonly frameFailureMessage: string | null;
};

export function observeFrameMotion(
  operation: LaserState['motionOperation'],
  state: GrblState,
  pendingUntrackedAcks: number,
  mpgOwnsControl: boolean,
  nextStatusSequence: number,
): FrameMotionObservation {
  const frameFailureMessage = frameStatusFailureMessage(operation, state, mpgOwnsControl);
  if (frameFailureMessage !== null) return { observed: null, frameFailureMessage };
  return {
    observed: applyMotionTerminalAckFence(
      operation,
      observeMotionStatus(operation, state, nextStatusSequence),
      pendingUntrackedAcks,
    ),
    frameFailureMessage: null,
  };
}

export function nextFrameDispatch(
  operation: LaserState['motionOperation'],
  observation: FrameMotionObservation,
): ReturnType<typeof takeNextMotionLine> {
  if (observation.frameFailureMessage !== null || operation === null) return null;
  return observation.observed === null ? takeNextMotionLine(operation) : null;
}

export function frameCompletionPatch(args: {
  readonly operation: LaserState['motionOperation'];
  readonly observedOperation: LaserState['motionOperation'];
  readonly queuedFrameDispatch: ReturnType<typeof takeNextMotionLine>;
  readonly positionInvalidated: boolean;
  readonly state: LaserState;
  readonly report: StatusReport;
  readonly nextSequence: number;
  readonly positionPatch: Partial<
    Pick<LaserState, 'wcoCache' | 'workOriginActive' | 'workOriginSource'>
  >;
  readonly frameFailureMessage: string | null;
}): Partial<Pick<LaserState, 'framedRun' | 'frameVerification' | 'lastWriteError' | 'log'>> {
  if (args.positionInvalidated || args.frameFailureMessage !== null) return {};
  const completedFrame = cleanCompletedFrameOperation(
    args.operation,
    args.observedOperation,
    args.queuedFrameDispatch,
  );
  if (completedFrame === null) return {};
  const candidate = completedFrame.candidate ?? null;
  if (candidate === null) {
    // PR #288 compatibility: legacy callers attach only the verification
    // record. Preserve that proof after the richer terminal settlement, but
    // never mint a Start permit without the exact reviewed-job candidate.
    return completedFrame.verification === undefined
      ? {}
      : { frameVerification: completedFrame.verification };
  }
  const source = {
    controllerSessionEpoch: args.state.controllerSessionEpoch,
    controllerSettings: args.state.controllerSettings,
    controllerSettingsObservation: args.state.controllerSettingsObservation,
    controllerBuildInfo: args.state.controllerBuildInfo,
    controllerBuildInfoObservation: args.state.controllerBuildInfoObservation,
    statusReport: args.report,
    statusSequence: args.nextSequence,
    wcoCache: args.positionPatch.wcoCache ?? args.state.wcoCache,
    workOriginActive: args.positionPatch.workOriginActive ?? args.state.workOriginActive,
    workOriginSource: args.positionPatch.workOriginSource ?? args.state.workOriginSource,
    trustedPositionEpoch: args.state.trustedPositionEpoch ?? 0,
    workZReferenceEpoch: args.state.workZReferenceEpoch,
    workZZeroEvidence: args.state.workZZeroEvidence,
  } as const;
  const issue = framedRunCompletionIssue(candidate, source);
  if (issue !== null) {
    return {
      framedRun: null,
      frameVerification: null,
      lastWriteError: issue,
      log: pushLog(args.state, `[lf2] ${issue}`),
    };
  }
  return {
    framedRun: createFramedRunPermit(candidate, source),
    frameVerification: candidate.frameVerification,
  };
}

type FrameMotionOperation = Extract<
  NonNullable<LaserState['motionOperation']>,
  { readonly kind: 'frame' }
>;

function cleanCompletedFrameOperation(
  operation: LaserState['motionOperation'],
  observed: LaserState['motionOperation'],
  queued: ReturnType<typeof takeNextMotionLine>,
): FrameMotionOperation | null {
  if (
    operation?.kind !== 'frame' ||
    operation.cancelRequested === true ||
    observed !== null ||
    queued !== null
  ) {
    return null;
  }
  return operation;
}
