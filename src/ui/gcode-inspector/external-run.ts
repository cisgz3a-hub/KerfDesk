// external-run — Frame and Start for a G-code file opened in the Inspector
// (ADR-630). The program is read from where the head stands (its first move,
// relative moves and arcs start there). The Frame uses the ordinary Frame
// boundary (controller queue, G54 selection, report units, completion
// settlement), traces the program's XY envelope with the tool off and returns
// to that start. A clean completion records a Frame for this exact program;
// Start checks that record, that the head is still at the start, and that the
// controller session, origin and machine mode are unchanged, then streams the
// program once through the ordinary streamer. Every other finding is a warning.

import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { streamingModeForController, type ControllerKind } from '../../core/devices';
import type { ExternalProgramEnvelope, LitRapids } from '../../core/external-program';
import type { KerfDeskBitFile } from '../../core/external-program/kerfdesk-bit-file';
import { machineKindOf, type MachineKind, type Project } from '../../core/scene';
import { confirmCncSetup } from '../laser/cnc-setup-acknowledgement';
import { confirmLaserModeStartEvidence } from '../laser/laser-mode-start-acknowledgement';
import { controllerStartPreparationStillCurrent } from '../laser/start-job-authorization';
import { prepareTransientFrameController } from '../laser/use-frame-action';
import { startUntrackedRun } from '../laser/untracked-start-retirement';
import { useStore } from '../state';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import type { FrameVerification } from '../state/frame-verification';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { jogFrameCommandBlockMessage } from '../state/laser-store-helpers';
import { externalLaserModeStartPrompt } from './external-run-readiness';

export type ExternalRun = {
  readonly controllerKind?: ControllerKind;
  readonly name: string;
  /** The exact bytes Start streams (normalizeExternalProgram). */
  readonly gcode: string;
  readonly envelope: ExternalProgramEnvelope;
  /** The work position the program was read from, where it starts. */
  readonly start: { readonly x: number; readonly y: number; readonly z: number };
  /** The bit its KerfDesk per-bit header names, read from the file as opened. */
  readonly bitFile?: KerfDeskBitFile;
  /** The lit rapids the Inspector worker found in `gcode`, so Start's
   * acknowledgement does not scan the program again (ADR-630 Amendment 9). */
  readonly litRapids?: LitRapids | null;
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
export const EXTERNAL_HEAD_MOVED =
  'The head is not where the program was read from. It is read again from where the head stands; Frame again.';

// Closer than this, two reported positions are the same spot (reports carry
// three decimals of a millimetre).
const SAME_SPOT_MM = 0.002;

export const EXTERNAL_CONNECT_FIRST = 'Connect to the machine first.';

/** Why an external run cannot begin now, or null: it needs a connected, Idle
 * controller with no job, Frame, jog or other operation running. */
export function externalRunMachineBlock(laser: LaserState): string | null {
  if (laser.connection.kind !== 'connected') return EXTERNAL_CONNECT_FIRST;
  return jogFrameCommandBlockMessage(laser);
}

/** True while the head stands where `run` was read from. */
export function headAtRunStart(run: ExternalRun, laser: LaserState): boolean {
  const here = reportedWorkPositionMm(laser, laser.controllerSettings?.reportInches === true);
  if (here === null) return false;
  return (
    Math.abs(here.x - run.start.x) <= SAME_SPOT_MM &&
    Math.abs(here.y - run.start.y) <= SAME_SPOT_MM &&
    Math.abs(here.z - run.start.z) <= SAME_SPOT_MM
  );
}

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
  if (run.controllerKind !== undefined && run.controllerKind !== laser.activeControllerKind) {
    throw new Error(EXTERNAL_FRAME_CHANGED);
  }
  if (!headAtRunStart(run, laser)) throw new Error(EXTERNAL_HEAD_MOVED);
  frameSequence += 1;
  const verification: FrameVerification = {
    boundsSignature: `external-program:${frameSequence}`,
    wco: laser.wcoCache,
    workOriginActive: laser.workOriginActive,
  };
  const completion = waitForExternalFrame(verification);
  try {
    const { framingFeedMmPerMin } = deviceForActiveHead(project.device, project.machine);
    await controller.laser.frame(run.envelope, framingFeedMmPerMin, undefined, project, undefined, {
      verification,
      returnToWorkPosition: { x: run.start.x, y: run.start.y },
    });
  } catch (error) {
    completion.cancel();
    throw error;
  }
  const settled = await completion.promise;
  if (settled === null) return null;
  const machineKind = machineKindOf(project.machine);
  return {
    run: startAfterFrame(run, machineKind, settled),
    machineKind,
    verification,
    controller: settled,
  };
}

// A CNC Frame that began below safe Z leaves the bit retracted: it does not
// plunge back into the stock (ADR-192). The program then starts from there,
// so it is read again from that height (ADR-630 Amendment 1). A head found
// anywhere else keeps the start it was read from, and Start says it moved.
function startAfterFrame(
  run: ExternalRun,
  machineKind: MachineKind,
  settled: LaserState,
): ExternalRun {
  if (machineKind !== 'cnc') return run;
  const here = reportedWorkPositionMm(settled, settled.controllerSettings?.reportInches === true);
  if (here === null) return run;
  const sameXy =
    Math.abs(here.x - run.start.x) <= SAME_SPOT_MM &&
    Math.abs(here.y - run.start.y) <= SAME_SPOT_MM;
  if (!sameXy || here.z <= run.start.z + SAME_SPOT_MM) return run;
  return { ...run, start: { x: run.start.x, y: run.start.y, z: here.z } };
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
  return externalHandoffIssue(frame, laser, project);
}

/** The checks that must still hold at the final Start handoff, after the
 * Frame record itself has been spent: same machine mode, same controller
 * session, origin and position, and the head at the program's start. */
function externalHandoffIssue(frame: ExternalFrame, laser: LaserState, project: Project) {
  if (
    frame.run.controllerKind !== undefined &&
    frame.run.controllerKind !== laser.activeControllerKind
  ) {
    return EXTERNAL_FRAME_CHANGED;
  }
  if (machineKindOf(project.machine) !== frame.machineKind) return EXTERNAL_MODE_CHANGED;
  if (
    !controllerStartPreparationStillCurrent(frame.controller, laser, {
      ignoreAdvisoryControllerEvidence: true,
    })
  ) {
    return EXTERNAL_FRAME_CHANGED;
  }
  return headAtRunStart(frame.run, laser) ? null : EXTERNAL_HEAD_MOVED;
}

/** Streams the framed program once. False when the operator declined a
 * confirmation; a factual refusal throws with its reason. */
export async function startExternalProgram(frame: ExternalFrame): Promise<boolean> {
  const issue = externalStartIssue(frame);
  if (issue !== null) throw new Error(issue);
  const project = useStore.getState().project;
  const laser = useLaserStore.getState();
  const { gcode } = frame.run;
  // The Run review lists the controller's $30/$32 findings (ADR-630
  // Amendment 4); this acknowledgement cites them and names lit rapids.
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    project,
    captureLaserModeStartSnapshot(laser),
    jobAwareConfirm,
    gcode,
    externalLaserModeStartPrompt(project, laser, gcode, frame.run.litRapids),
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
  // The external program keeps no recovery record (ADR-630), but once it may
  // have reached the controller the project's last job is no longer the last
  // thing the machine ran: its recovery card, Run again and second pass go.
  await startUntrackedRun(() =>
    useLaserStore.getState().startJob(gcode, {
      streamingMode: streamingModeForController(
        project.device.controllerKind,
        project.device.streamingMode,
      ),
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind: frame.machineKind,
      // M0/M1 in an external CNC program are controller program stops, not
      // KerfDesk's emitted multi-bit plan boundaries. Preserve the exact bytes.
      toolChangePause: false,
      // Its own G54-G59, offset and tool words may change what the store
      // records; those records go as it starts (ADR-630 Amendment 6).
      externalProgram: true,
      // Its end is a bit change: Work Z goes and the X/Y origin holds for the
      // set's later bits (bit-file-sequence.ts, ADR-392 Amendment 4).
      ...(frame.run.bitFile === undefined ? {} : { externalBitFile: frame.run.bitFile }),
      // Start clears the Frame record before this runs, so it checks what the
      // record was bound to. Start arming can take a while, during which the
      // Laser/CNC switch stays usable, so the machine mode is checked here too.
      assertFinalStartAuthorized: () => {
        const issue = externalHandoffIssue(
          frame,
          useLaserStore.getState(),
          useStore.getState().project,
        );
        if (issue !== null) throw new Error(issue);
      },
      ...(laserModeStartEvidence === undefined ? {} : { laserModeStartEvidence }),
      ...(cncSetupAttestation === null || cncSetupAttestation === undefined
        ? {}
        : { cncSetupAttestation }),
    }),
  );
  return true;
}
