// external-run — Frame and Start for a G-code file opened in the Inspector
// (ADR-630). The Frame uses the ordinary Frame boundary (controller queue,
// G54 selection, report units, completion settlement) and traces the
// program's XY envelope with the tool off. A clean completion records a Frame
// for this exact program; Start checks that record and that the controller
// session, position and origin are unchanged, then streams the program once
// through the ordinary streamer. Every other finding is a warning.

import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { streamingModeForController } from '../../core/devices';
import type { ExternalProgramEnvelope } from '../../core/external-program';
import { machineKindOf, type MachineKind, type Project } from '../../core/scene';
import { confirmCncSetup } from '../laser/cnc-setup-acknowledgement';
import { confirmLaserModeStartEvidence } from '../laser/laser-mode-start-acknowledgement';
import { controllerStartPreparationStillCurrent } from '../laser/start-job-authorization';
import { prepareTransientFrameController } from '../laser/use-frame-action';
import { useStore } from '../state';
import type { FrameVerification } from '../state/frame-verification';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore, type LaserState } from '../state/laser-store';

export type ExternalRun = {
  readonly name: string;
  /** The exact bytes Start streams (normalizeExternalProgram). */
  readonly gcode: string;
  readonly envelope: ExternalProgramEnvelope;
};

/** A clean Frame of one external program, as the controller stood after it. */
export type ExternalFrame = {
  readonly run: ExternalRun;
  readonly machineKind: MachineKind;
  readonly verification: FrameVerification;
  readonly controller: LaserState;
};

export const EXTERNAL_FRAME_FIRST =
  'Frame this program first. Start unlocks when the Frame finishes cleanly.';
export const EXTERNAL_FRAME_CHANGED =
  'The controller session, position or origin changed after the Frame. Frame the program again.';
export const EXTERNAL_MODE_CHANGED =
  'The machine mode changed after the Frame. Frame the program again.';

let frameSequence = 0;

/** The project the Frame motion follows: the current machine and device, with
 * none of the project's own frame start point (that belongs to its artwork). */
function framingProject(project: Project): Project {
  const { startPoints: _ignored, ...rest } = project;
  return rest;
}

/** Traces the program's envelope. Resolves with the Frame record once the
 * motion finishes cleanly, or null when it was refused, cancelled or failed. */
export async function frameExternalProgram(run: ExternalRun): Promise<ExternalFrame | null> {
  const project = framingProject(useStore.getState().project);
  const controller = await prepareTransientFrameController(project);
  if (controller === null) return null;
  const laser = useLaserStore.getState();
  frameSequence += 1;
  const verification: FrameVerification = {
    boundsSignature: `external-program:${frameSequence}`,
    wco: laser.wcoCache,
    workOriginActive: laser.workOriginActive,
  };
  const completion = waitForExternalFrame(verification);
  try {
    const { framingFeedMmPerMin } = deviceForActiveHead(project.device, project.machine);
    await controller.laser.frame(
      run.envelope,
      framingFeedMmPerMin,
      undefined,
      project,
      undefined,
      verification,
    );
  } catch (error) {
    completion.cancel();
    throw error;
  }
  const settled = await completion.promise;
  if (settled === null) return null;
  return { run, machineKind: machineKindOf(project.machine), verification, controller: settled };
}

/** Resolves with the controller state that recorded `verification`, or with
 * null once the Frame motion ends without recording it. */
export function waitForExternalFrame(verification: FrameVerification): {
  readonly promise: Promise<LaserState | null>;
  readonly cancel: () => void;
} {
  let finish: (state: LaserState | null) => void = () => undefined;
  const promise = new Promise<LaserState | null>((resolve) => {
    finish = resolve;
  });
  let sawFrame = false;
  const unsubscribe = useLaserStore.subscribe((state) => {
    if (state.frameVerification === verification) {
      unsubscribe();
      finish(state);
      return;
    }
    if (state.motionOperation?.kind === 'frame') sawFrame = true;
    else if (sawFrame && state.motionOperation === null) {
      unsubscribe();
      finish(null);
    }
  });
  return {
    promise,
    cancel: () => {
      unsubscribe();
      finish(null);
    },
  };
}

/** Why Start cannot run this framed program now, or null when it can. */
export function externalStartIssue(
  frame: ExternalFrame | null,
  laser: LaserState = useLaserStore.getState(),
  project: Project = useStore.getState().project,
): string | null {
  if (frame === null || laser.frameVerification !== frame.verification) {
    return EXTERNAL_FRAME_FIRST;
  }
  if (machineKindOf(project.machine) !== frame.machineKind) return EXTERNAL_MODE_CHANGED;
  return controllerStartPreparationStillCurrent(frame.controller, laser, {
    ignoreAdvisoryControllerEvidence: true,
  })
    ? null
    : EXTERNAL_FRAME_CHANGED;
}

/** Streams the framed program once. False when the operator declined a
 * confirmation; a factual refusal throws with its reason. */
export async function startExternalProgram(frame: ExternalFrame): Promise<boolean> {
  const issue = externalStartIssue(frame);
  if (issue !== null) throw new Error(issue);
  const project = useStore.getState().project;
  const laser = useLaserStore.getState();
  const { gcode } = frame.run;
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    project,
    captureLaserModeStartSnapshot(laser),
    jobAwareConfirm,
    gcode,
  );
  if (laserModeStartEvidence === null) return false;
  const cncSetupAttestation = confirmCncSetup(
    frame.machineKind,
    gcode,
    laser.ovCache,
    jobAwareConfirm,
  );
  if (frame.machineKind === 'cnc' && cncSetupAttestation === null) return false;
  // A confirmation dialog can outlast a controller change.
  const afterConfirm = externalStartIssue(frame);
  if (afterConfirm !== null) throw new Error(afterConfirm);
  await useLaserStore.getState().startJob(gcode, {
    streamingMode: streamingModeForController(
      project.device.controllerKind,
      project.device.streamingMode,
    ),
    rxBufferBytes: project.device.rxBufferBytes,
    machineKind: frame.machineKind,
    // M0/M1 in an external CNC program are controller program stops, not
    // KerfDesk's emitted multi-bit plan boundaries. Preserve the exact bytes.
    toolChangePause: false,
    // Start clears the Frame record before this runs, so it checks the
    // controller evidence the record was bound to.
    assertFinalStartAuthorized: () => {
      const current = useLaserStore.getState();
      if (
        !controllerStartPreparationStillCurrent(frame.controller, current, {
          ignoreAdvisoryControllerEvidence: true,
        })
      ) {
        throw new Error(EXTERNAL_FRAME_CHANGED);
      }
    },
    ...(laserModeStartEvidence === undefined ? {} : { laserModeStartEvidence }),
    ...(cncSetupAttestation === null || cncSetupAttestation === undefined
      ? {}
      : { cncSetupAttestation }),
  });
  return true;
}
