import { streamingModeForController } from '../../core/devices';
import type { JobCheckpoint } from '../../core/recovery';
import type { MachineKind, OutputScope, Project } from '../../core/scene';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { StartJobOptions, useLaserStore } from '../state/laser-store';
import type { createRunId, LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import type { CncSetupAttestation } from '../state/cnc-setup-attestation';
import type { LaserModeStartEvidence } from '../state/laser-mode-start-evidence';
import { armVariableStreamAdvancement } from './variable-stream-advancement';
import type { prepareCurrentStartJob } from './start-job-source';
import type { StartExternalEnvironment } from './start-job-external-environment';
import type { JobReviewModel } from './job-review';
import { activateAcceptedFreshRun } from './start-job-execution-tracking';
import {
  currentLaserForAuthorizedStartNow,
  type CurrentStartAuthorizationArgs,
  type StartAuthorization,
  type StartAuthorizationRefusal,
} from './start-job-authorization';
import {
  reportStartAuthorizationRefusal,
  startAuthorizationRefusalMessage,
} from './start-job-authorization-reporting';
import { useStartBlockerStore } from './start-blocker-store';
import type { FramedRunStartClaim } from './framed-run-start-claim';

export type PreparedStartArgs = {
  readonly outputScope: OutputScope;
  readonly project: Project;
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly prepared: Extract<Awaited<ReturnType<typeof prepareCurrentStartJob>>, { ok: true }>;
  readonly machineKind: MachineKind;
  readonly reviewedAtIso: string;
  readonly reviewModel: JobReviewModel;
  readonly laserModeStartEvidence: LaserModeStartEvidence | undefined;
  readonly cncSetupAttestation: CncSetupAttestation | undefined;
  readonly checkpointToReplace: JobCheckpoint | null;
  readonly completedReceipt: LastCompletedReceipt | null;
  readonly externalEnvironment: StartExternalEnvironment;
  readonly repository: RecoveryRepository;
  readonly framedRunClaim?: FramedRunStartClaim;
};

export async function transmitPreparedStart(input: {
  readonly args: PreparedStartArgs;
  readonly runId: ReturnType<typeof createRunId>;
  readonly staged: boolean;
  readonly handoffArmed: boolean;
  readonly authorizationArgs: CurrentStartAuthorizationArgs;
  readonly authorization: Extract<StartAuthorization, { readonly ok: true }>;
}): Promise<void> {
  let { staged, handoffArmed } = input;
  let boundaryRefusal: StartAuthorizationRefusal | null = null;
  const assertion = finalStartAssertion(input.authorizationArgs, (refusal) => {
    boundaryRefusal = refusal;
  });
  try {
    // startJob repeats this synchronous gate after its final await and
    // immediately before streamer creation.
    await input.authorization.laser.startJob(
      input.args.prepared.gcode,
      preparedStartOptions(input.args, input.runId, assertion),
    );
    const acceptedHandoff = handoffArmed;
    handoffArmed = false;
    staged = false;
    await activateAcceptedFreshRun(input.runId, acceptedHandoff, input.args.repository);
    armVariableStreamAdvancement(input.args.project);
  } catch (error) {
    if (handoffArmed) await input.args.repository.cancelPendingStart(input.runId);
    if (staged) await input.args.repository.discardStagedRun(input.runId);
    if (boundaryRefusal !== null) {
      await reportStartAuthorizationRefusal(
        boundaryRefusal,
        input.args.completedReceipt,
        input.args.repository,
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    useStartBlockerStore.getState().report([message]);
    jobAwareAlert(`Could not start job:\n\n${message}`);
  }
}

function preparedStartOptions(
  args: PreparedStartArgs,
  runId: ReturnType<typeof createRunId>,
  assertFinalStartAuthorized: () => void,
): StartJobOptions {
  return {
    runId,
    assertFinalStartAuthorized,
    streamingMode: streamingModeForController(
      args.project.device.controllerKind,
      args.project.device.streamingMode,
    ),
    rxBufferBytes: args.project.device.rxBufferBytes,
    machineKind: args.machineKind,
    ...(args.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: args.laserModeStartEvidence }),
    ...(args.prepared.cncToolPlan === undefined ? {} : { cncToolPlan: args.prepared.cncToolPlan }),
    ...(args.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: args.cncSetupAttestation }),
    canvasPlan: args.prepared.canvasPlan,
    ...(args.framedRunClaim === undefined ? {} : { framedRunPermit: args.framedRunClaim.permit }),
  };
}

function finalStartAssertion(
  args: CurrentStartAuthorizationArgs,
  onRefusal: (refusal: StartAuthorizationRefusal) => void,
): () => void {
  return () => {
    const authorization = currentLaserForAuthorizedStartNow(args);
    if (authorization.ok) return;
    onRefusal(authorization.refusal);
    throw new Error(startAuthorizationRefusalMessage(authorization.refusal));
  };
}
