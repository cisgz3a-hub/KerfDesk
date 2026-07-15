import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import type { SimilarityTransform } from '../../core/registration';
import type { OutputScope } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { canvasPlanRetentionKey } from '../state/canvas-motion-plan';
import type { LaserState } from '../state/laser-store';
import {
  createExecutionArtifact,
  type LastCompletedReceipt,
  type RecoveryRepository,
  type RunId,
} from '../state/recovery';
import { useToastStore } from '../state/toast-store';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import type { prepareCurrentStartJob } from './start-job-source';

type PreparedCurrentStart = Extract<
  Awaited<ReturnType<typeof prepareCurrentStartJob>>,
  { readonly ok: true }
>;

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
}): Promise<boolean> {
  try {
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
      createdAtIso: new Date().toISOString(),
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
  await repository.noteUntrackedRunAccepted();
  useToastStore
    .getState()
    .pushToast(
      'Job recovery is unavailable for this run. The job can continue normally.',
      'warning',
    );
}
