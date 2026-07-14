// runStartJobFlow — the full Start-job sequence (readiness checks →
// operator confirmation → stream). Extracted from LaserWindow so the
// toolbar button and the Ctrl+Return shortcut (M22, WORKFLOW F-A15) run the
// identical flow. Reads both stores imperatively at call time.
//
// Dialogs go through the job-aware wrappers (H13): pass-through natives
// when no job is active — which is the normal case here, since
// prepareStartJob refuses to run while a job is active — but the
// startJob-failed alert in the catch arm can fire after streaming began,
// and a native dialog there would freeze the ack pump and Stop button.

import { buildResumeProgram } from '../../core/controllers/grbl';
import type { StatusQueryCapability } from '../../core/controllers';
import { CNC_AUTOMATIC_RECOVERY_DISABLED_REASON } from '../../core/controllers/grbl/resume-program';
import {
  profileSupportsCapability,
  streamingModeForController,
  type ControllerKind,
} from '../../core/devices';
import {
  createJobCheckpoint,
  fingerprintGcode,
  fingerprintsEqual,
  markResumeInFlight,
  rawResumeLine,
  type JobCheckpoint,
} from '../../core/recovery';
import type { JobOriginPlacement } from '../../core/job';
import { machineKindOf, type MachineKind, type OutputScope, type Project } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { isActiveJob } from '../state/laser-store-helpers';
import {
  CNC_SETUP_ATTESTATION_PROMPT,
  cncControllerEpochOf,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from '../state/cnc-setup-attestation';
import { prepareStartJob, prepareStartJobSnapshot } from './start-job-readiness';
import { renderVariableText } from '../text/render-variable-text';
import { armVariableStreamAdvancement } from './variable-stream-advancement';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { resumeConfirmation } from './resume-confirmation';
import { useCameraStore } from '../state/camera-store';
import { cameraPlacementGeometryIssue } from '../camera/camera-surface-height';
import {
  rebuildCanvasPlanForGcode,
  reportedWorkPositionMm,
  type CanvasMotionPlan,
} from '../state/canvas-motion-plan';

export async function runStartJobFlow(): Promise<void> {
  const app = useStore.getState();
  const { project } = app;
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = await prepareCurrentStartJob(app, laser, camera);
  if (!prepared.ok) {
    const lines = prepared.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot start job:\n\n${lines}`);
    return;
  }
  if (prepared.warnings.length > 0) {
    const lines = prepared.warnings.map((message) => `• ${message}`).join('\n');
    if (!jobAwareConfirm(`Controller warning:\n\n${lines}\n\nStart anyway?`)) return;
  }
  const machineKind = machineKindOf(project.machine);
  const cncSetupAttestation = confirmCncSetup(machineKind, prepared.gcode);
  if (cncSetupAttestation === null) return;
  try {
    await laser.startJob(prepared.gcode, {
      streamingMode: streamingModeForController(
        project.device.controllerKind,
        project.device.streamingMode,
      ),
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind,
      ...(prepared.cncToolPlan === undefined ? {} : { cncToolPlan: prepared.cncToolPlan }),
      ...(cncSetupAttestation === undefined ? {} : { cncSetupAttestation }),
      canvasPlan: prepared.canvasPlan,
    });
    armVariableStreamAdvancement(project);
    // Checkpoint the run only once the stream is actually under way
    // (ADR-118); a refused start must not overwrite an older recovery
    // record. useJobCheckpoint advances it from streamer acks.
    writeJobCheckpoint(
      createJobCheckpoint({
        gcode: prepared.gcode,
        machineKind,
        // Capture the scope + RESOLVED origin THIS run compiled with so resume
        // reproduces identical bytes even after a crash resets the live values
        // (PST-02) and re-resolves current-position to the post-crash head (R1).
        outputScope: currentOutputScope(app),
        ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
        nowIso: new Date().toISOString(),
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not start job:\n\n${message}`);
  }
}

async function prepareCurrentStartJob(
  app: ReturnType<typeof useStore.getState>,
  laser: ReturnType<typeof useLaserStore.getState>,
  camera: ReturnType<typeof useCameraStore.getState>,
) {
  const { project, jobPlacement } = app;
  const registration = currentPrintCutOutputRegistration(project);
  return prepareStartJobSnapshot(
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
      ovCache: laser.ovCache,
      accessoryCache: laser.accessoryCache ?? null,
      frameVerification: laser.frameVerification,
      settingsCapability: laser.capabilities.settings,
      activeControllerKind: laser.activeControllerKind,
      detectedControllerKind: laser.detectedControllerKind,
      cameraPlacementActive: camera.placementActive,
      cameraConfirmedPositionEpoch: camera.confirmedPositionEpoch,
      cameraPlacementGeometryIssue: cameraPlacementGeometryIssue(
        project.device.cameraAlignment,
        project.device.cameraCalibration,
        camera.surfaceHeightMm,
      ),
      homingState: laser.homingState,
      trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
      reportInches: laser.controllerSettings?.reportInches === true,
      statusQuery: liveStatusQueryCapability(
        laser.activeControllerKind,
        laser.capabilities.statusQuery,
      ),
    },
    jobPlacement,
    currentOutputScope(app),
    rotaryRasterAllowed(project),
    {
      clock: () => new Date(),
      renderVariableText,
      ...(registration === undefined ? {} : { registration }),
    },
  );
}

function confirmCncSetup(
  machineKind: MachineKind,
  gcode: string,
): CncSetupAttestation | null | undefined {
  if (machineKind !== 'cnc') return undefined;
  if (!jobAwareConfirm(CNC_SETUP_ATTESTATION_PROMPT)) return null;
  return createCncSetupAttestation(gcode, cncControllerEpochOf(useLaserStore.getState()));
}

// Resume a stopped/errored laser job from a chosen 1-based RAW line. CNC
// recovery is intentionally blocked before compile and again in the core
// builder because acknowledgement position is not physical machine state.
export async function runStartFromLineFlow(fromLine: number): Promise<void> {
  if (machineKindOf(useStore.getState().project.machine) === 'cnc') {
    jobAwareAlert(`Cannot resume CNC job:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`);
    return;
  }
  const prepared = prepareResume();
  if (prepared === null) return;
  await streamResumeFromRawLine(prepared.project, prepared.gcode, fromLine, prepared.canvasPlan);
}

// Resume the checkpointed interrupted job (ADR-118): re-compile the project,
// REFUSE when its bytes no longer match the checkpoint's fingerprint (an
// edited project silently renumbers every line), then map the acked-sendable
// count back to the raw line the stream died at.
export async function runCheckpointResumeFlow(checkpoint: JobCheckpoint): Promise<void> {
  if (checkpoint.machineKind === 'cnc') {
    jobAwareAlert(`Cannot resume CNC job:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`);
    return;
  }
  // Recompile with the run's OWN scope + resolved origin (PST-02, R1): a crash
  // resets the live output scope and re-resolves current-position against the
  // post-crash head, both of which would renumber every line and trip the
  // fingerprint refusal below. The frozen origin reproduces the exact bytes.
  const prepared = prepareResume({
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  });
  if (prepared === null) return;
  if (!fingerprintsEqual(fingerprintGcode(prepared.gcode), checkpoint.fingerprint)) {
    jobAwareAlert(
      'Cannot resume the interrupted job:\n\n' +
        'The current project no longer produces the same G-code as the interrupted run — ' +
        'it was edited since (a changed object, output scope, or job placement all ' +
        'renumber the lines), so they no longer match. Re-open the original project, or ' +
        'use Start from line… manually if you are sure of the line.',
    );
    return;
  }
  const fromLine = rawResumeLine(prepared.gcode, checkpoint.ackedLines);
  await streamResumeFromRawLine(prepared.project, prepared.gcode, fromLine, prepared.canvasPlan);
}

// Shared resume front half: readiness gate + re-compile. Same gate as a
// fresh start (minus the settings-capability warning, matching the original
// Start-from-line behavior). A checkpoint resume passes the scope + placement
// the ORIGINAL run used so the recompiled bytes match its fingerprint even
// after a crash reset the live values (PST-02); the manual Start-from-line path
// passes nothing and uses current app state, as before.
function prepareResume(overrides?: {
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
}): {
  readonly project: Project;
  readonly gcode: string;
  readonly canvasPlan: CanvasMotionPlan;
} | null {
  const app = useStore.getState();
  const { project } = app;
  const outputScope = overrides?.outputScope ?? currentOutputScope(app);
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = prepareStartJob(
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
      ovCache: laser.ovCache,
      accessoryCache: laser.accessoryCache ?? null,
      frameVerification: laser.frameVerification,
      activeControllerKind: laser.activeControllerKind,
      detectedControllerKind: laser.detectedControllerKind,
      cameraPlacementActive: camera.placementActive,
      cameraConfirmedPositionEpoch: camera.confirmedPositionEpoch,
      cameraPlacementGeometryIssue: cameraPlacementGeometryIssue(
        project.device.cameraAlignment,
        project.device.cameraCalibration,
        camera.surfaceHeightMm,
      ),
      homingState: laser.homingState,
      trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
      reportInches: laser.controllerSettings?.reportInches === true,
      statusQuery: liveStatusQueryCapability(
        laser.activeControllerKind,
        laser.capabilities.statusQuery,
      ),
    },
    app.jobPlacement,
    outputScope,
    overrides?.jobOrigin,
    rotaryRasterAllowed(project),
  );
  if (!prepared.ok) {
    const lines = prepared.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot resume job:\n\n${lines}`);
    return null;
  }
  return { project, gcode: prepared.gcode, canvasPlan: prepared.canvasPlan };
}

function rotaryRasterAllowed(project: Project): boolean {
  return (
    useExperimentalLaserFeatures.getState().features.rotaryRaster &&
    profileSupportsCapability(project.device, 'rotary')
  );
}

// Shared resume back half: build the re-entry program, confirm, suspend
// checkpoint tracking (the resume run has its own numbering — ADR-118), and
// stream it.
async function streamResumeFromRawLine(
  project: Project,
  gcode: string,
  fromLine: number,
  originalCanvasPlan: CanvasMotionPlan,
): Promise<void> {
  const machine = project.machine;
  const resume = buildResumeProgram(gcode, fromLine, {
    machineKind: machineKindOf(project.machine),
    safeZMm: machine?.kind === 'cnc' ? machine.params.safeZMm : 0,
    spindleSpinupSec: machine?.kind === 'cnc' ? machine.params.spindleSpinupSec : 0,
    plungeMmPerMin: RESUME_PLUNGE_MM_PER_MIN,
  });
  if (resume.kind === 'error') {
    jobAwareAlert(`Cannot resume from line ${fromLine}:\n\n${resume.reason}`);
    return;
  }
  const proceed = jobAwareConfirm(
    resumeConfirmation(machineKindOf(project.machine), fromLine, resume.fromLine),
  );
  if (!proceed) return;
  const checkpoint = readJobCheckpoint();
  if (checkpoint !== null) {
    writeJobCheckpoint(markResumeInFlight(checkpoint, new Date().toISOString()));
  }
  try {
    const laser = useLaserStore.getState();
    const resumeGcode = resume.lines.join('\n');
    const initialPosition = reportedWorkPositionMm(
      laser,
      laser.controllerSettings?.reportInches === true,
    );
    await useLaserStore.getState().startJob(resume.lines.join('\n'), {
      streamingMode: streamingModeForController(
        project.device.controllerKind,
        project.device.streamingMode,
      ),
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind: machineKindOf(project.machine),
      canvasPlan: rebuildCanvasPlanForGcode(
        originalCanvasPlan,
        resumeGcode,
        initialPosition ?? undefined,
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not resume job:\n\n${message}`);
  }
}

const RESUME_PLUNGE_MM_PER_MIN = 300;

function liveStatusQueryCapability(
  controllerKind: ControllerKind,
  configured: StatusQueryCapability,
): StatusQueryCapability {
  if (controllerKind === 'marlin') return 'queued-poll';
  if (controllerKind === 'ruida') return 'none';
  return configured;
}
