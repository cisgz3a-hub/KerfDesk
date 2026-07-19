import { computeJobBounds, frameBoundsSignature } from '../../core/job';
import { machineKindOf } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { useCameraStore } from '../state/camera-store';
import { cncControllerEpochOf, createCncSetupAttestation } from '../state/cnc-setup-attestation';
import {
  createFramedRunPermit,
  framedRunControllerSnapshot,
  type FramedRunCandidate,
  type FramedRunPermit,
} from '../state/framed-run';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import type { StatusReport } from '../../core/controllers/grbl';
import { captureStartExternalEnvironment } from './start-job-external-environment';
import { prepareCurrentStartJob } from './start-job-source';
import { confirmLaserModeStartEvidence } from './laser-mode-start-acknowledgement';
import { buildJobReviewModel } from './job-review';

export function idleControllerStatusForFrameTest(): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 31, y: 42, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

/**
 * Test-only equivalent of a cleanly completed Frame for the stores' current
 * exact job. Production permits are minted exclusively by the final physical
 * Frame Idle in laser-status-line.ts.
 */
export async function framedRunPermitForCurrentState(): Promise<FramedRunPermit> {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const externalEnvironment = captureStartExternalEnvironment(app.project, camera);
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    externalEnvironment.rotaryRasterAllowed,
    undefined,
    false,
  );
  if (!prepared.ok) {
    throw new Error(`Cannot build a framed-run fixture: ${prepared.messages.join(' ')}`);
  }
  const bounds = computeJobBounds(prepared.prepared.job, app.project.device);
  if (bounds === null) throw new Error('Cannot build a framed-run fixture for an empty job.');

  const machineKind = machineKindOf(app.project.machine);
  const laserSnapshot = captureLaserModeStartSnapshot(laser);
  const reviewModel = buildJobReviewModel({
    project: app.project,
    prepared,
    laserModeStartSnapshot: laserSnapshot,
    overrides: laser.ovCache,
  });
  const position = reportedWorkPositionMm(laser, laser.controllerSettings?.reportInches === true);
  if (position === null) {
    throw new Error('Cannot build a framed-run fixture without a reported work position.');
  }
  const candidate: FramedRunCandidate = {
    preparedStart: prepared,
    project: app.project,
    outputScope: currentOutputScope(app),
    executionSignature: prepared.canvasPlan.retentionKey,
    controllerBeforeFrame: framedRunControllerSnapshot(laser),
    returnToWorkPosition: { x: position.x, y: position.y },
    reviewedAtIso: new Date().toISOString(),
    reviewModel,
    frameVerification: {
      boundsSignature: frameBoundsSignature(bounds),
      wco: laser.wcoCache,
      workOriginActive: laser.workOriginActive,
    },
    externalEnvironment,
    ...(machineKind === 'laser'
      ? {
          laserModeStartEvidence: requiredLaserModeEvidence(
            app.project,
            laserSnapshot,
            prepared.gcode,
          ),
        }
      : {
          cncSetupAttestation: createCncSetupAttestation(
            prepared.gcode,
            cncControllerEpochOf(laser),
          ),
        }),
  };
  return createFramedRunPermit(candidate, laser);
}

function requiredLaserModeEvidence(
  project: ReturnType<typeof useStore.getState>['project'],
  snapshot: ReturnType<typeof captureLaserModeStartSnapshot>,
  gcode: string,
) {
  const evidence = confirmLaserModeStartEvidence(project, snapshot, () => true, gcode);
  if (evidence === null || evidence === undefined) {
    throw new Error('Cannot build a framed-run fixture without laser-mode Start evidence.');
  }
  return evidence;
}

export async function installFramedRunPermitForCurrentState(): Promise<FramedRunPermit> {
  const permit = await framedRunPermitForCurrentState();
  useLaserStore.setState({
    framedRun: permit,
    frameVerification: permit.candidate.frameVerification,
  });
  return permit;
}

/** Test-only completion seam for a mocked physical Frame dispatch. */
export function completeFramedRunCandidateForTest(candidate: FramedRunCandidate): void {
  useLaserStore.setState({
    motionOperation: {
      operationId: 1,
      kind: 'frame',
      candidate,
      sawControllerBusy: false,
      idleStatusReports: 0,
      dispatchComplete: true,
      pendingLines: [],
    },
  });
  useLaserStore.setState((laser) => ({
    motionOperation: null,
    framedRun: createFramedRunPermit(candidate, laser),
    frameVerification: candidate.frameVerification,
  }));
}
