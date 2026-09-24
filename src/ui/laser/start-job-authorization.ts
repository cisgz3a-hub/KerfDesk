import type { JobCheckpoint } from '../../core/recovery';
import type { FramedRunControllerSnapshot } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { laserSecondPassExecutionSignature } from '../state/recovery/laser-second-pass-lineage';
import { checkpointStartIssue } from './start-job-checkpoint-policy';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
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
  if (!startExecutionInputsMatch(args)) {
    return { ok: false, refusal: { kind: 'execution-inputs-changed' } };
  }
  const current = useLaserStore.getState();
  if (
    controllerStartPreparationStillCurrent(args.preparedAgainst, current, {
      // ADR-232: a completion-issued ordinary-Start permit survives a later
      // $30/$32 or $I refresh. Settings and build capability stay advisory;
      // the wire boundary later checks reviewed evidence and exact M7 shape.
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

function startExecutionInputsMatch(args: CurrentStartAuthorizationArgs): boolean {
  const candidate = args.framedRunClaim?.permit.candidate;
  if (candidate?.authorizationContext !== 'laser-second-pass') {
    return currentReplayExecutionSignature() === args.expectedExecutionSignature;
  }
  // A painted pass owns immutable derived bytes, so the open canvas is not one
  // of its inputs. Its identity is the sealed lineage: the permit's signature
  // must still name the source run and the exact selection of its last stage.
  const stage = candidate.preparedStart.laserSecondPassChain?.at(-1);
  return (
    stage !== undefined &&
    candidate.executionSignature ===
      laserSecondPassExecutionSignature(stage.sourceRunId, stage.selection)
  );
}

export function controllerStartPreparationStillCurrent(
  preparedAgainst: ReturnType<typeof useLaserStore.getState> | FramedRunControllerSnapshot,
  current: ReturnType<typeof useLaserStore.getState>,
  options: {
    readonly ignoreStatusState?: boolean;
    readonly ignoreAdvisoryControllerEvidence?: boolean;
  } = {},
): boolean {
  const offset = preparationOffset(preparedAgainst);
  return (
    sameControllerEvidence(
      preparedAgainst,
      current,
      options.ignoreAdvisoryControllerEvidence === true,
    ) &&
    sameAxes(preparationOffset(current), offset) &&
    sameStartStatus(
      current.statusReport,
      preparedAgainst.statusReport,
      options.ignoreStatusState === true,
      offset,
      current.controllerSettings?.reportInches === true,
    ) &&
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
  // Report units interpret raw position/WCO numbers, even at zero. They are
  // coordinate identity rather than advisory settings/build metadata.
  if (
    (current.controllerSettings?.reportInches === true) !==
    (preparedAgainst.controllerSettings?.reportInches === true)
  )
    return false;
  if (ignoreAdvisoryEvidence) return true;
  return (
    current.controllerSettings === preparedAgainst.controllerSettings &&
    current.controllerSettingsObservation === preparedAgainst.controllerSettingsObservation &&
    current.controllerBuildInfo === preparedAgainst.controllerBuildInfo &&
    current.controllerBuildInfoObservation === preparedAgainst.controllerBuildInfoObservation
  );
}

type Axes = NonNullable<FramedRunControllerSnapshot['wcoCache']>;

function preparationOffset(
  snapshot: Pick<FramedRunControllerSnapshot, 'wcoCache' | 'workOriginActive' | 'workOriginSource'>,
): Axes | null {
  if (snapshot.wcoCache !== null) return snapshot.wcoCache;
  // Placement already treats an absent offset as zero only without a custom
  // origin. Its first explicit zero report does not change the compiled job.
  return !snapshot.workOriginActive && snapshot.workOriginSource === 'none'
    ? { x: 0, y: 0, z: 0 }
    : null;
}

function sameStartStatus(
  current: ReturnType<typeof useLaserStore.getState>['statusReport'],
  preparedAgainst: ReturnType<typeof useLaserStore.getState>['statusReport'],
  ignoreState: boolean,
  offset: Axes | null,
  reportInches: boolean,
): boolean {
  if (current === null || preparedAgainst === null) return current === preparedAgainst;
  // WCO is an intermittent GRBL status field. The stable wcoCache is compared
  // by controllerStartPreparationStillCurrent; comparing report.wco here would
  // expire a valid Frame merely because the next unchanged report omitted it.
  return (
    (ignoreState ||
      (current.state === preparedAgainst.state && current.subState === preparedAgainst.subState)) &&
    samePositionField(current, preparedAgainst, 'mPos', offset, reportInches) &&
    samePositionField(current, preparedAgainst, 'wPos', offset, reportInches)
  );
}

function samePositionField(
  current: NonNullable<FramedRunControllerSnapshot['statusReport']>,
  preparedAgainst: NonNullable<FramedRunControllerSnapshot['statusReport']>,
  field: 'mPos' | 'wPos',
  offset: Axes | null,
  reportInches: boolean,
): boolean {
  const left = current[field];
  const right = preparedAgainst[field];
  // Keep observed movement strict when both samples use the same field. A
  // second reported field must also agree; it cannot hide behind a stable one.
  if ((left === null) === (right === null)) return sameAxes(left, right);
  if (offset === null) return false;
  const other = field === 'mPos' ? 'wPos' : 'mPos';
  const sign = field === 'mPos' ? 1 : -1;
  const resolvedLeft = left ?? translatedPosition(current[other], offset, sign);
  const resolvedRight = right ?? translatedPosition(preparedAgainst[other], offset, sign);
  if (resolvedLeft === null || resolvedRight === null) return false;
  // GRBL reports coordinates at 0.001 mm / 0.0001 inch (0.00254 mm).
  // Subtracting separately rounded MPos and WCO may differ from rounded WPos
  // by one reporting tick. Allow that only for this representation conversion,
  // never for changed offsets or two direct observations of the same field.
  // https://github.com/gnea/grbl/blob/master/grbl/config.h
  const tick = reportInches ? 0.0001 : 0.001;
  return (['x', 'y', 'z'] as const).every((axis) => {
    const a = resolvedLeft[axis];
    const b = resolvedRight[axis];
    if (offset[axis] === 0) return a === b;
    const arithmeticError =
      Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(offset[axis])) * 4;
    return Math.abs(a - b) <= tick + arithmeticError;
  });
}

function translatedPosition(position: Axes | null, offset: Axes, sign: number): Axes | null {
  return position === null
    ? null
    : {
        x: position.x + sign * offset.x,
        y: position.y + sign * offset.y,
        z: position.z + sign * offset.z,
      };
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
