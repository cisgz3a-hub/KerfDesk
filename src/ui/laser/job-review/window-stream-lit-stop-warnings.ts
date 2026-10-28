// Job Review's warning for a job streamed from the app window whose power stays
// on when the head stops (rolling audit v6 K1, ADR-675). The window's thread
// also runs edits, Undo, imports and renders, and while it is busy nothing
// refills the controller. Its buffered moves last only tens of milliseconds to
// about a second, so the head stops, and the power the last move set stays on
// over that one spot (core/gcode/stopped-head-power.ts).
//
// A worker streams USB GRBL-family and Marlin connections and desktop network
// sessions, so this appears only where that path is unavailable: a USB
// adapter without a unique identity, Background streaming turned off, or a
// worker that could not start. Advisory only, never a Start gate (ADR-565):
// the transport can still deliver the job.

import type { ControllerKind } from '../../../core/devices';
import {
  findStoppedHeadPower,
  type StoppedHeadPower,
} from '../../../core/gcode/stopped-head-power';
import type { LaserState } from '../../state/laser-store';

export const WINDOW_STREAM_LIT_STOP_PREFIX =
  'This connection sends the job from the KerfDesk window';

const HEAD = `${WINDOW_STREAM_LIT_STOP_PREFIX}, not from a background worker. While the window is busy (a large edit, Undo or an import) nothing refills the controller, so it runs out of moves and stops the head.`;

const WORKER_ROUTE =
  'To stream it from a worker instead, turn Background streaming on in Machine Setup and reconnect; on USB, also leave only one adapter of this kind plugged in. Until then, do not edit the project while it runs.';

export function detectWindowStreamLitStopWarnings(args: {
  readonly connected: boolean;
  readonly jobStreamHost: 'worker' | 'window' | null | undefined;
  readonly controllerKind: ControllerKind;
  readonly gcode: string;
}): ReadonlyArray<string> {
  if (!args.connected || args.jobStreamHost !== 'window') return [];
  const firmware = scannedFirmware(args.controllerKind);
  if (firmware === null) return [];
  const finding = findStoppedHeadPower(args.gcode, firmware);
  if (finding === null) return [];
  return [`${HEAD} ${riskSentence(finding.kind, finding.line)} ${WORKER_ROUTE}`];
}

/** The same warning, read from the live laser session at review time. */
export function liveWindowStreamLitStopWarnings(
  live: Pick<LaserState, 'connection' | 'jobStreamHost' | 'activeControllerKind'>,
  gcode: string,
): ReadonlyArray<string> {
  return detectWindowStreamLitStopWarnings({
    connected: live.connection.kind === 'connected',
    jobStreamHost: live.jobStreamHost,
    controllerKind: live.activeControllerKind,
    gcode,
  });
}

function scannedFirmware(kind: ControllerKind): 'grbl' | 'marlin' | null {
  if (kind === 'grbl-v1.1' || kind === 'grblhal' || kind === 'fluidnc') return 'grbl';
  return kind === 'marlin' ? 'marlin' : null;
}

function riskSentence(kind: StoppedHeadPower, line: number): string {
  switch (kind) {
    case 'grbl-constant':
      return `This job burns with constant power (M3, from line ${line}), and the controller keeps that power on over the stopped head until the window sends again, with no timeout, or until the E-stop if the window does not recover: a burn-through and fire risk. Dynamic power (M4) goes dark when the head stops; set the operations' Power mode to Dynamic (M4) or choose GRBL Dynamic in Machine Setup.`;
    case 'marlin-cutter':
      return `Marlin keeps a constant-power beam (from line ${line}) on over the stopped head until its laser safety timeout, LASER_SAFETY_TIMEOUT_MS: 1 s in stock builds, and no limit when a build sets it to 0. Every stall leaves another dwell mark.`;
    case 'marlin-fan':
      return `This laser runs from Marlin's fan output (M106, from line ${line}), which keeps its last power when the head stops and has no timeout: the beam stays on over the stopped head until the window sends again, and until you press the E-stop if the window does not recover. Keep a hand on the E-stop.`;
  }
}
