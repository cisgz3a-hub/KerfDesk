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
import type { JobReviewModel } from './job-review';
import {
  activateAcceptedFreshRun,
  stageFreshExecutionArtifact,
} from './start-job-execution-tracking';
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
import { reportStartBlockers } from './start-blocker-invalidation';
import type { FramedRunStartClaim } from './framed-run-start-claim';
import { isJobStartTransmissionError } from '../state/laser-start-transmission-error';

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
  readonly repository: RecoveryRepository;
  readonly framedRunClaim?: FramedRunStartClaim;
};

export async function transmitPreparedStart(input: {
  readonly args: PreparedStartArgs;
  readonly runId: ReturnType<typeof createRunId>;
  readonly handoffArmed: boolean;
  readonly authorizationArgs: CurrentStartAuthorizationArgs;
  readonly authorization: Extract<StartAuthorization, { readonly ok: true }>;
}): Promise<boolean> {
  let { handoffArmed } = input;
  let boundaryRefusal: StartAuthorizationRefusal | null = null;
  const assertion = finalStartAssertion(input.authorizationArgs, (refusal) => {
    boundaryRefusal = refusal;
  });
  // Observe before the first possible stream transition. A short program may
  // settle while startJob or recovery persistence is still awaiting a write.
  const advancement = armVariableStreamAdvancement(
    input.args.project,
    input.runId,
    input.args.outputScope,
  );
  let startAccepted = false;
  try {
    // startJob repeats this synchronous gate after its final await and
    // immediately before streamer creation.
    await input.authorization.laser.startJob(
      input.args.prepared.gcode,
      preparedStartOptions(input.args, input.runId, assertion),
    );
    startAccepted = true;
    advancement.accept();
    handoffArmed = false;
    // ADR-337: the archive is built and stored only now, off the path between
    // Start and motion. The handoff armed before the wire already carries the
    // operator-facing truth if this never completes.
    await archiveAcceptedFreshRun(input.args, input.runId);
    return true;
  } catch (error) {
    if (!startAccepted) advancement.cancel();
    if (isJobStartTransmissionError(error) && error.runId === input.runId) {
      // A rejected write can still have delivered a prefix. The pending intent
      // belongs to this attempted program until its exact archive takes over.
      handoffArmed = false;
      await archiveAcceptedFreshRun(input.args, input.runId);
      await input.args.repository.interruptRun(input.runId, error.ackedLines, {
        kind: 'write-failed',
        message: error.message,
      });
    }
    if (handoffArmed) await input.args.repository.cancelPendingStart(input.runId);
    if (boundaryRefusal !== null) {
      await reportStartAuthorizationRefusal(
        boundaryRefusal,
        input.args.completedReceipt,
        input.args.repository,
      );
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    reportStartBlockers([message]);
    jobAwareAlert(`Could not start job:\n\n${message}`);
    return false;
  }
}

/** Build and store the execution archive for a run the controller has already
 * accepted, then hand tracking from the pending intent to the active run.
 * Staging is best-effort by construction (it cannot un-send the program), and
 * `activateAcceptedFreshRun` already owns telling the operator when a run will
 * have no forensic record. */
async function archiveAcceptedFreshRun(
  args: PreparedStartArgs,
  runId: ReturnType<typeof createRunId>,
): Promise<void> {
  const staged = await stageFreshExecutionArtifact({
    runId,
    prepared: args.prepared,
    outputScope: args.outputScope,
    laser: args.laser,
    repository: args.repository,
    reviewedAtIso: args.reviewedAtIso,
    reviewModel: args.reviewModel,
    ...(args.laserModeStartEvidence === undefined
      ? {}
      : { laserModeStartEvidence: args.laserModeStartEvidence }),
    ...(args.cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation: args.cncSetupAttestation }),
    ...(args.completedReceipt === null
      ? {}
      : { completedReplaySourceRunId: args.completedReceipt.runId }),
  });
  await activateAcceptedFreshRun(runId, staged, args.repository);
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
    ...(args.prepared.jobTimingPlan === undefined
      ? {}
      : { jobTimingPlan: args.prepared.jobTimingPlan }),
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
