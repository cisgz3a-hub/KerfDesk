import { streamingModeForController } from '../../../core/devices';
import { DEFAULT_OUTPUT_SCOPE, machineKindOf, type Project } from '../../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../../job-placement';
import { prepareStartJobSnapshot } from '../../laser/start-job-readiness';
import { useCameraStore } from '../../state/camera-store';
import { jobAwareAlert, jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { isActiveJob } from '../../state/laser-store-helpers';
import { renderVariableText } from '../../text/render-variable-text';

/** Stream a temporary camera-calibration project without replacing, dirtying,
 * or adding undo entries to the operator's real project. */
export async function runTransientCameraJob(project: Project): Promise<boolean> {
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = await prepareStartJobSnapshot(
    project,
    laser.controllerSettings,
    {
      statusReport: laser.statusReport,
      alarmCode: laser.alarmCode,
      hasActiveStreamer: isActiveJob(laser.streamer),
      cncJobsSupported: laser.capabilities.cncJobs,
      motionOperationActive: laser.motionOperation !== null,
      controllerOperationActive: laser.controllerOperation !== null,
      autofocusBusy: laser.autofocusBusy,
      workOriginActive: laser.workOriginActive,
      workZZeroEvidence: laser.workZZeroEvidence,
      workZReferenceEpoch: laser.workZReferenceEpoch,
      wcoCache: laser.wcoCache,
      frameVerification: laser.frameVerification,
      settingsCapability: laser.capabilities.settings,
      cameraPlacementActive: true,
      cameraConfirmedPositionEpoch: camera.confirmedPositionEpoch,
      homingState: laser.homingState,
      trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    },
    DEFAULT_JOB_PLACEMENT,
    DEFAULT_OUTPUT_SCOPE,
    false,
    { clock: () => new Date(), renderVariableText },
  );
  if (!prepared.ok) {
    jobAwareAlert(`Cannot burn camera markers:\n\n${bulletLines(prepared.messages)}`);
    return false;
  }
  if (
    prepared.warnings.length > 0 &&
    !jobAwareConfirm(`Controller warning:\n\n${bulletLines(prepared.warnings)}\n\nBurn markers?`)
  ) {
    return false;
  }
  try {
    await laser.startJob(prepared.gcode, {
      streamingMode: streamingModeForController(
        project.device.controllerKind,
        project.device.streamingMode,
      ),
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind: machineKindOf(project.machine),
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not burn camera markers:\n\n${message}`);
    return false;
  }
}

function bulletLines(messages: ReadonlyArray<string>): string {
  return messages.map((message) => `- ${message}`).join('\n');
}
