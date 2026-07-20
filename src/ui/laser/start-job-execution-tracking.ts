import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import type { SimilarityTransform } from '../../core/registration';
import type { OutputScope } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { canvasPlanRetentionKey } from '../state/canvas-motion-plan';
import type { LaserState } from '../state/laser-store';
import type { CncSetupAttestation } from '../state/cnc-setup-attestation';
import type { LaserModeStartEvidence } from '../state/laser-mode-start-evidence';
import {
  createArchivedControllerObservation,
  createExecutionArtifact,
  type LastCompletedReceipt,
  type RecoveryRepository,
  type RunId,
} from '../state/recovery';
import { useToastStore } from '../state/toast-store';
import type { JobReviewModel } from './job-review';
import { createExecutionProvenance } from '../state/recovery/execution-provenance';
import { ordinaryExecutionEvidence } from '../state/recovery/execution-workflow-evidence';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import type { prepareCurrentStartJob } from './start-job-source';

type PreparedCurrentStart = Extract<
  Awaited<ReturnType<typeof prepareCurrentStartJob>>,
  { readonly ok: true }
>;

// Shared by the pre-review discard toast (start-job-flow) and the in-dialog
// replay blocker (job-review gate) so the operator reads one message.
export const COMPLETED_REPLAY_CHANGED_MESSAGE =
  'The completed job changed. Use Start job to run the current canvas.';

export function replayCompilationMatches(
  prepared: PreparedCurrentStart,
  receipt: LastCompletedReceipt,
): boolean {
  return (
    prepared.canvasPlan.retentionKey === receipt.artifact.executionSignature &&
    fingerprintsEqual(fingerprintGcode(prepared.gcode), receipt.artifact.fingerprint)
  );
}

export function currentReplayExecutionSignature(
  app: ReturnType<typeof useStore.getState> = useStore.getState(),
  registration: SimilarityTransform | null | undefined = currentPrintCutOutputRegistration(
    app.project,
  ),
): string {
  return canvasPlanRetentionKey(
    app.project,
    currentOutputScope(app),
    app.jobPlacement,
    registration,
  );
}

export async function completedReceiptIsCurrent(
  receipt: LastCompletedReceipt,
  repository: RecoveryRepository,
): Promise<boolean> {
  const refreshed = await repository.refresh();
  const current = refreshed.ok ? refreshed.value.lastCompletedReceipt : null;
  if (current?.runId === receipt.runId) return true;
  useToastStore
    .getState()
    .pushToast(
      'The completed-job replay offer changed. Review the current job controls.',
      'warning',
    );
  return false;
}

export async function stageFreshExecutionArtifact(args: {
  readonly runId: RunId;
  readonly prepared: PreparedCurrentStart;
  readonly outputScope: OutputScope;
  readonly laser: LaserState;
  readonly repository: RecoveryRepository;
  readonly reviewedAtIso: string;
  readonly reviewModel: JobReviewModel;
  readonly laserModeStartEvidence?: LaserModeStartEvidence;
  readonly cncSetupAttestation?: CncSetupAttestation;
  readonly completedReplaySourceRunId?: RunId;
}): Promise<boolean> {
  try {
    const evidence = ordinaryExecutionEvidence({
      reviewedAtIso: args.reviewedAtIso,
      warningsShown: args.reviewModel.warnings,
      acknowledgement: args.reviewModel.acknowledgement,
      ...(args.completedReplaySourceRunId === undefined
        ? {}
        : { completedReplaySourceRunId: args.completedReplaySourceRunId }),
      ...(args.laserModeStartEvidence === undefined
        ? {}
        : { laserModeStartEvidence: args.laserModeStartEvidence }),
      ...(args.cncSetupAttestation === undefined
        ? {}
        : { cncSetupAttestation: args.cncSetupAttestation }),
    });
    const createdAtIso = new Date().toISOString();
    const archivedControllerObservation = createArchivedControllerObservation({
      controllerSettings: args.laser.controllerSettings,
      observedAtIso: createdAtIso,
      controllerObservation: {
        statusReport: args.laser.statusReport,
        wco: args.laser.wcoCache,
        overrides: args.laser.ovCache,
        accessories: args.laser.accessoryCache ?? null,
        workZZeroEvidence: args.laser.workZZeroEvidence,
        activeControllerKind: args.laser.activeControllerKind,
        detectedControllerKind: args.laser.detectedControllerKind,
        controllerSessionEpoch: args.laser.controllerSessionEpoch,
      },
    });
    const provenance = await createExecutionProvenance({
      gcode: args.prepared.gcode,
      profile: args.prepared.prepared.project.device,
      laser: args.laser,
      archivedControllerObservation,
      ...evidence,
    });
    const artifact = createExecutionArtifact({
      runId: args.runId,
      gcode: args.prepared.gcode,
      prepared: args.prepared.prepared,
      outputScope: args.outputScope,
      ...(args.prepared.jobOrigin === undefined ? {} : { jobOrigin: args.prepared.jobOrigin }),
      canvasPlan: args.prepared.canvasPlan,
      ...(args.prepared.cncToolPlan === undefined
        ? {}
        : { cncToolPlan: args.prepared.cncToolPlan }),
      controllerSettings: args.laser.controllerSettings,
      archivedControllerObservation,
      createdAtIso,
      provenance,
    });
    const staged = await args.repository.stageArtifact(artifact);
    if (staged.ok) return true;
  } catch {
    // Recovery persistence is best-effort and must never refuse current Start.
  }
  return false;
}

export async function activateAcceptedFreshRun(
  runId: RunId,
  staged: boolean,
  repository: RecoveryRepository,
): Promise<void> {
  if (staged) {
    const activated = await repository.activateFreshRun(runId);
    if (activated.ok && activated.value) return;
  }
  await repository.noteUntrackedRunAccepted(runId);
  useToastStore
    .getState()
    .pushToast(
      'Job recovery is unavailable for this run, and no execution archive was retained. The job can continue, but this burn will not have a forensic record.',
      'warning',
    );
}
