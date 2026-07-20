import type { JobCheckpoint } from '../../core/recovery';
import { useCameraStore } from '../state/camera-store';
import type { FramedRunControllerSnapshot } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { useStore } from '../state/store';
import { checkpointStartIssue } from './start-job-checkpoint-policy';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import {
  startExternalEnvironmentMatches,
  type StartExternalEnvironment,
} from './start-job-external-environment';
import { framedRunStartClaimIsCurrent, type FramedRunStartClaim } from './framed-run-start-claim';

export type StartAuthorizationRefusal =
  | { readonly kind: 'completed-receipt-changed' }
  | { readonly kind: 'execution-inputs-changed' }
  | { readonly kind: 'blocked'; readonly message: string };

export type StartAuthorization =
  | { readonly ok: true; readonly laser: ReturnType<typeof useLaserStore.getState> }
  | { readonly ok: false; readonly refusal: StartAuthorizationRefusal };

export type CurrentStartAuthorizationArgs = {
  readonly preparedAgainst: ReturnType<typeof useLaserStore.getState> | FramedRunControllerSnapshot;
  readonly checkpointToReplace: JobCheckpoint | null;
  readonly completedReceipt: LastCompletedReceipt | null;
  readonly expectedExecutionSignature: string;
  readonly externalEnvironment: StartExternalEnvironment;
  readonly repository: RecoveryRepository;
  /** Ordinary fresh Start only. Replay/recovery retain their existing
   * authorization paths and therefore omit this exact-permit claim. */
  readonly framedRunClaim?: FramedRunStartClaim;
};

export const FRAMED_RUN_START_CLAIM_CHANGED_MESSAGE =
  'The completed Frame permit was consumed, replaced, or revoked while Start was being prepared. Frame the exact job again before starting.';

/**
 * This gate must remain synchronous: startJob invokes it after its last
 * asynchronous controller check and immediately before streamer creation.
 */
export function currentLaserForAuthorizedStartNow(
  args: CurrentStartAuthorizationArgs,
): StartAuthorization {
  if (args.framedRunClaim !== undefined && !framedRunStartClaimIsCurrent(args.framedRunClaim)) {
    return {
      ok: false,
      refusal: { kind: 'blocked', message: FRAMED_RUN_START_CLAIM_CHANGED_MESSAGE },
    };
  }
  const checkpointIssue = checkpointStartIssue(args.checkpointToReplace);
  if (checkpointIssue !== null) {
    return { ok: false, refusal: { kind: 'blocked', message: checkpointIssue } };
  }
  if (
    args.completedReceipt !== null &&
    args.repository.getSnapshot().lastCompletedReceipt?.runId !== args.completedReceipt.runId
  ) {
    return { ok: false, refusal: { kind: 'completed-receipt-changed' } };
  }
  if (currentReplayExecutionSignature() !== args.expectedExecutionSignature) {
    return { ok: false, refusal: { kind: 'execution-inputs-changed' } };
  }
  const camera = useCameraStore.getState();
  if (
    !startExternalEnvironmentMatches(args.externalEnvironment, useStore.getState().project, camera)
  ) {
    return { ok: false, refusal: { kind: 'execution-inputs-changed' } };
  }
  const current = useLaserStore.getState();
  if (
    controllerStartPreparationStillCurrent(args.preparedAgainst, current, {
      // ADR-232: a completion-issued ordinary-Start permit survives a later
      // $30/$32 or $I refresh. Settings stay advisory, while the store checks
      // the exact program against current M7 evidence at the queue fence.
      ignoreAdvisoryControllerEvidence: args.framedRunClaim !== undefined,
    })
  ) {
    return { ok: true, laser: current };
  }
  return {
    ok: false,
    refusal: {
      kind: 'blocked',
      message:
        'Controller or machine setup changed while Start was being prepared. Review the current setup and press Start again.',
    },
  };
}

export function controllerStartPreparationStillCurrent(
  preparedAgainst: ReturnType<typeof useLaserStore.getState> | FramedRunControllerSnapshot,
  current: ReturnType<typeof useLaserStore.getState>,
  options: {
    readonly ignoreStatusState?: boolean;
    readonly ignoreAdvisoryControllerEvidence?: boolean;
  } = {},
): boolean {
  return (
    sameControllerEvidence(
      preparedAgainst,
      current,
      options.ignoreAdvisoryControllerEvidence === true,
    ) &&
    sameStartStatus(
      current.statusReport,
      preparedAgainst.statusReport,
      options.ignoreStatusState === true,
    ) &&
    sameAxes(current.wcoCache, preparedAgainst.wcoCache) &&
    current.workOriginActive === preparedAgainst.workOriginActive &&
    current.workOriginSource === preparedAgainst.workOriginSource &&
    current.trustedPositionEpoch === preparedAgainst.trustedPositionEpoch &&
    current.workZReferenceEpoch === preparedAgainst.workZReferenceEpoch &&
    current.workZZeroEvidence === preparedAgainst.workZZeroEvidence
  );
}

function sameControllerEvidence(
  preparedAgainst: ReturnType<typeof useLaserStore.getState> | FramedRunControllerSnapshot,
  current: ReturnType<typeof useLaserStore.getState>,
  ignoreAdvisoryEvidence: boolean,
): boolean {
  if (current.controllerSessionEpoch !== preparedAgainst.controllerSessionEpoch) return false;
  if (ignoreAdvisoryEvidence) return true;
  return (
    current.controllerSettings === preparedAgainst.controllerSettings &&
    current.controllerSettingsObservation === preparedAgainst.controllerSettingsObservation &&
    current.controllerBuildInfo === preparedAgainst.controllerBuildInfo &&
    current.controllerBuildInfoObservation === preparedAgainst.controllerBuildInfoObservation
  );
}

function sameStartStatus(
  current: ReturnType<typeof useLaserStore.getState>['statusReport'],
  preparedAgainst: ReturnType<typeof useLaserStore.getState>['statusReport'],
  ignoreState: boolean,
): boolean {
  if (current === null || preparedAgainst === null) return current === preparedAgainst;
  // WCO is an intermittent GRBL status field. The stable wcoCache is compared
  // by controllerStartPreparationStillCurrent; comparing report.wco here would
  // expire a valid Frame merely because the next unchanged report omitted it.
  return (
    (ignoreState ||
      (current.state === preparedAgainst.state && current.subState === preparedAgainst.subState)) &&
    sameAxes(current.mPos, preparedAgainst.mPos) &&
    sameAxes(current.wPos, preparedAgainst.wPos)
  );
}

function sameAxes(
  current: { readonly x: number; readonly y: number; readonly z: number } | null,
  preparedAgainst: { readonly x: number; readonly y: number; readonly z: number } | null,
): boolean {
  return (
    current === preparedAgainst ||
    (current !== null &&
      preparedAgainst !== null &&
      current.x === preparedAgainst.x &&
      current.y === preparedAgainst.y &&
      current.z === preparedAgainst.z)
  );
}
