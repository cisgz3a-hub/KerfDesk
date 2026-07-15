import type { JobCheckpoint } from '../../core/recovery';
import { useCameraStore } from '../state/camera-store';
import { controllerQualificationStartBlockMessage } from '../state/laser-controller-qualification';
import { useLaserStore } from '../state/laser-store';
import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { useStore } from '../state/store';
import { checkpointStartIssue } from './start-job-checkpoint-policy';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import {
  startExternalEnvironmentMatches,
  type StartExternalEnvironment,
} from './start-job-external-environment';

export type StartAuthorizationRefusal =
  | { readonly kind: 'completed-receipt-changed' }
  | { readonly kind: 'execution-inputs-changed' }
  | { readonly kind: 'blocked'; readonly message: string };

export type StartAuthorization =
  | { readonly ok: true; readonly laser: ReturnType<typeof useLaserStore.getState> }
  | { readonly ok: false; readonly refusal: StartAuthorizationRefusal };

export type CurrentStartAuthorizationArgs = {
  readonly preparedAgainst: ReturnType<typeof useLaserStore.getState>;
  readonly checkpointToReplace: JobCheckpoint | null;
  readonly completedReceipt: LastCompletedReceipt | null;
  readonly expectedExecutionSignature: string;
  readonly externalEnvironment: StartExternalEnvironment;
  readonly repository: RecoveryRepository;
};

/**
 * This gate must remain synchronous: startJob invokes it after its last
 * asynchronous controller check and immediately before streamer creation.
 */
export function currentLaserForAuthorizedStartNow(
  args: CurrentStartAuthorizationArgs,
): StartAuthorization {
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
  const qualificationIssue = controllerQualificationStartBlockMessage(
    current.controllerQualification,
    current.controllerSessionEpoch,
  );
  if (qualificationIssue !== null) {
    return { ok: false, refusal: { kind: 'blocked', message: qualificationIssue } };
  }
  if (startPreparationStillCurrent(args.preparedAgainst, current)) {
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

function startPreparationStillCurrent(
  preparedAgainst: ReturnType<typeof useLaserStore.getState>,
  current: ReturnType<typeof useLaserStore.getState>,
): boolean {
  return (
    current.controllerSessionEpoch === preparedAgainst.controllerSessionEpoch &&
    current.controllerSettings === preparedAgainst.controllerSettings &&
    current.controllerSettingsObservation === preparedAgainst.controllerSettingsObservation &&
    sameStartStatus(current.statusReport, preparedAgainst.statusReport) &&
    sameAxes(current.wcoCache, preparedAgainst.wcoCache) &&
    current.workOriginActive === preparedAgainst.workOriginActive &&
    current.workOriginSource === preparedAgainst.workOriginSource &&
    current.trustedPositionEpoch === preparedAgainst.trustedPositionEpoch &&
    current.workZReferenceEpoch === preparedAgainst.workZReferenceEpoch &&
    current.workZZeroEvidence === preparedAgainst.workZZeroEvidence
  );
}

function sameStartStatus(
  current: ReturnType<typeof useLaserStore.getState>['statusReport'],
  preparedAgainst: ReturnType<typeof useLaserStore.getState>['statusReport'],
): boolean {
  if (current === null || preparedAgainst === null) return current === preparedAgainst;
  return (
    current.state === preparedAgainst.state &&
    current.subState === preparedAgainst.subState &&
    sameAxes(current.mPos, preparedAgainst.mPos) &&
    sameAxes(current.wPos, preparedAgainst.wPos) &&
    sameAxes(current.wco, preparedAgainst.wco)
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
