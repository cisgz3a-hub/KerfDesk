import {
  buildLaserSecondPassProgram,
  type LaserSecondPassSelection,
} from '../../core/laser-second-pass';
import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import { estimateJobDuration } from '../../core/job';
import { buildMotionManifest, type MotionPoint } from '../../core/job/motion-manifest';
import type { FramedRunPermit, PreparedStartProgram } from '../state/framed-run';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import {
  recoveryRepository,
  type ExecutionArtifactV1,
  type RecoveryRepository,
} from '../state/recovery';
import { isCurrentExecutionArtifact } from '../state/recovery/execution-artifact';
import { executionArtifactIntegrityIsValid } from '../state/recovery/execution-artifact-integrity';
import {
  isLaserSecondPassChain,
  laserSecondPassExecutionSignature,
} from '../state/recovery/laser-second-pass-lineage';
import { useToastStore } from '../state/toast-store';
import { recoveryArtifactPreparedOutput } from './recovery-artifact-binding';
import { dispatchLaserSecondPassFrame, prepareTransientFrameController } from './use-frame-action';
import { runFramedPermitStart } from './start-job-flow';
import {
  verifiedLaserSecondPassPreparation,
  requalifyVerifiedLaserSecondPassPreparation,
  captureLaserSecondPassSource,
  laserSecondPassSourceMatches,
  type LaserSecondPassFrameGeometry,
} from './second-pass-preparation-proof';
import { bindSecondPassCanvasToController } from './second-pass-canvas-binding';
export { registerVerifiedLaserSecondPassPreparation } from './second-pass-preparation-proof';

/** Freeze an exact, clipped program as a new job. This deliberately does not
 * install its source project or recalculate its placement from the live head. */
export async function frameLaserSecondPass(
  source: ExecutionArtifactV1,
  prepared: PreparedStartProgram,
  selection: LaserSecondPassSelection,
): Promise<FramedRunPermit | null> {
  try {
    // Capture before any preparation step: whatever clears the canvas permit
    // from here on, the operator ends this Frame without it.
    const replacesCanvasFrame = holdsOrdinaryCanvasFrame();
    const sourceSnapshot = captureLaserSecondPassSource(source);
    const outputScope = structuredClone(source.outputScope);
    const frozen = await bindSecondPassSource(source, prepared, selection);
    const project = frozen.prepared.project;
    const controller = await prepareTransientFrameController(project);
    if (controller === null) return null;
    assertUnchangedSecondPassSource(sourceSnapshot, source);
    const initial = reportedWorkPositionMm(
      controller.laser,
      controller.laser.controllerSettings?.reportInches === true,
    );
    if (initial === null)
      throw new Error('Wait for a fresh controller work position before framing the second pass.');
    const geometry =
      (await requalifyVerifiedLaserSecondPassPreparation(source, prepared, selection, initial)) ??
      fallbackFrameGeometry(frozen, initial);
    assertUnchangedSecondPassSource(sourceSnapshot, source);
    const current = {
      ...frozen,
      canvasPlan: { ...frozen.canvasPlan, manifest: geometry.manifest },
      metrics: { ...frozen.metrics, duration: geometry.duration },
    };
    const permit = await dispatchLaserSecondPassFrame(
      {
        app: useStore.getState(),
        project,
        laser: controller.laser,
        prepared: bindSecondPassCanvasToController(current, controller.laser),
        outputScope,
        laserModeStartSnapshot: captureLaserModeStartSnapshot(controller.laser),
        ...(controller.wcsNormalizationWarning === undefined
          ? {}
          : { frameWcsNormalizationWarning: controller.wcsNormalizationWarning }),
      },
      outputScope,
    );
    if (permit !== null && replacesCanvasFrame) {
      useToastStore.getState().pushToast(CANVAS_FRAME_REPLACED_MESSAGE, 'info');
    }
    return permit;
  } catch (error) {
    jobAwareAlert(
      `Cannot frame the second pass:\n\n${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export const CANVAS_FRAME_REPLACED_MESSAGE =
  'The second-pass Frame replaced the earlier Frame of the canvas job. Frame the canvas job again before starting it.';

/** The store holds one permit. Framing a painted pass consumes an armed
 * ordinary Frame, which the operator would otherwise discover only at Start. */
function holdsOrdinaryCanvasFrame(): boolean {
  const permit = useLaserStore.getState().framedRun;
  return permit !== null && permit.candidate.authorizationContext === undefined;
}

function assertUnchangedSecondPassSource(
  snapshot: ReturnType<typeof captureLaserSecondPassSource>,
  source: ExecutionArtifactV1,
): void {
  if (!laserSecondPassSourceMatches(snapshot, source))
    throw new Error('The saved source changed while Frame was being prepared. Reopen its preview.');
}

function fallbackFrameGeometry(
  prepared: PreparedStartProgram,
  initialPosition: MotionPoint,
): LaserSecondPassFrameGeometry {
  return {
    manifest: buildMotionManifest(prepared.gcode, { machineKind: 'laser', initialPosition }),
    duration: estimateJobDuration(prepared.prepared.job, prepared.prepared.project.device, {
      gcode: prepared.gcode,
      initialPosition,
    }),
  };
}

export async function startLaserSecondPass(
  permit: FramedRunPermit,
  repository: RecoveryRepository = recoveryRepository,
): Promise<boolean> {
  if (permit.candidate.authorizationContext !== 'laser-second-pass') return false;
  return runFramedPermitStart(permit, repository);
}

/** Cancel/edit owns only its own permit, never another tool's newer Frame. */
export function invalidateLaserSecondPassFrame(permit: FramedRunPermit | null): void {
  if (permit === null) return;
  useLaserStore.setState((state) =>
    state.framedRun === permit ? { framedRun: null, frameVerification: null } : {},
  );
}

async function bindSecondPassSource(
  source: ExecutionArtifactV1,
  prepared: PreparedStartProgram,
  selection: LaserSecondPassSelection,
): Promise<PreparedStartProgram> {
  const frozenSelection = structuredClone(selection);
  const verified =
    verifiedLaserSecondPassPreparation(source, prepared, frozenSelection) ??
    (await bindUnregisteredPreparation(source, prepared, frozenSelection));
  if (source.machineKind !== 'laser' || !previewMatches(source, verified, prepared.gcode)) {
    throw new Error('The second-pass preview changed. Prepare it again before framing.');
  }
  const stage = {
    sourceRunId: source.runId,
    sourceFingerprint: { ...source.fingerprint },
    resumeChainBefore: (source.laserResumeChain ?? []).map((step) => ({ ...step })),
    selection: frozenSelection,
  };
  const chain = [...structuredClone(source.laserSecondPassChain ?? []), stage];
  if (
    !isLaserSecondPassChain(chain) ||
    selection.maxPowerS !== source.prepared.project.device.maxPowerS
  ) {
    throw new Error('The second-pass power scale does not match the completed laser job.');
  }
  return {
    ...verified,
    laserSecondPassChain: chain,
    canvasPlan: {
      ...verified.canvasPlan,
      retentionKey: laserSecondPassExecutionSignature(source.runId, frozenSelection),
    },
  };
}

async function bindUnregisteredPreparation(
  source: ExecutionArtifactV1,
  prepared: PreparedStartProgram,
  selection: LaserSecondPassSelection,
): Promise<PreparedStartProgram> {
  if (
    source.machineKind !== 'laser' ||
    !isCurrentExecutionArtifact(source) ||
    !(await executionArtifactIntegrityIsValid(source))
  ) {
    throw new Error('The completed laser execution archive failed its integrity check.');
  }
  const original = recoveryArtifactPreparedOutput(source);
  if (original === null)
    throw new Error('The completed laser program no longer matches its archived source.');
  const derived = buildLaserSecondPassProgram(source.gcode, selection);
  if (derived.kind === 'error') throw new Error(derived.message);
  if (!previewMatches(source, prepared, derived.gcode)) {
    throw new Error('The second-pass preview changed. Prepare it again before framing.');
  }
  return {
    ...prepared,
    prepared: original,
    metrics: {
      ...prepared.metrics,
      jobBounds: derived.bounds,
      motionBounds: derived.motionBounds,
      frameJobBounds: derived.bounds,
      frameMotionBounds: derived.motionBounds,
    },
  };
}

function previewMatches(
  source: ExecutionArtifactV1,
  prepared: PreparedStartProgram,
  gcode: string,
): boolean {
  return (
    gcode === prepared.gcode &&
    fingerprintsEqual(prepared.canvasPlan.fingerprint, fingerprintGcode(gcode)) &&
    JSON.stringify(prepared.jobOrigin) === JSON.stringify(source.jobOrigin)
  );
}
