// Job Review's warning for a job streamed from the app window whose power stays
// on when the head stops (rolling audit v6 K1, ADR-676). The window's thread
// also runs edits, Undo, imports and renders, and while it is busy nothing
// refills the controller. Its buffered moves last only tens of milliseconds to
// about a second, so the head stops, and the power the last move set stays on
// over that one spot (core/gcode/stopped-head-power.ts).
//
// A worker streams USB GRBL-family and Marlin connections and desktop network
// sessions, so this appears only where that path is unavailable: a USB
// adapter without a unique identity, Background streaming turned off, or a
// worker that could not start. The advice names the route that can reach the
// worker from there (ADR-676 Amendment 5): reconnecting cannot help where the
// setting is already on. Advisory only, never a Start gate (ADR-565): the
// transport can still deliver the job.

import type { ControllerKind } from '../../../core/devices';
import {
  findStoppedHeadPower,
  type StoppedHeadPower,
} from '../../../core/gcode/stopped-head-power';
import type { WindowStreamReason } from '../../state/laser-connect-attempt';
import type { LaserState } from '../../state/laser-store';

export const WINDOW_STREAM_LIT_STOP_PREFIX =
  'This connection sends the job from the KerfDesk window';

const HEAD = `${WINDOW_STREAM_LIT_STOP_PREFIX}, not from a background worker. While the window is busy (a large edit, Undo or an import) nothing refills the controller, so it runs out of moves and stops the head.`;

const HOLD_EDITS = 'Until then, do not edit the project while it runs.';

/** How to reach a worker from this connection, by why the window streams. */
const WORKER_ROUTE: Readonly<Record<WindowStreamReason, string>> = {
  'opted-out': `Background streaming is off in Machine Setup for this machine. To stream it from a worker instead, turn it on and reconnect. ${HOLD_EDITS}`,
  'adapter-not-unique': `Background streaming is on, but its worker could not tell this USB adapter apart: another port KerfDesk may use has the same USB IDs, or this one reports none. Leave only one adapter of this kind plugged in and reconnect. ${HOLD_EDITS}`,
  'worker-unavailable':
    'Background streaming is on, but its worker could not start for this connection, so reconnecting is likely to end the same way. Do not edit the project while it runs.',
  'no-worker':
    'This connection has no background worker to stream it. Do not edit the project while it runs.',
};

export function detectWindowStreamLitStopWarnings(args: {
  readonly connected: boolean;
  readonly jobStreamHost: 'worker' | 'window' | null | undefined;
  /** Why the window streams; unknown reads as a transport with no worker. */
  readonly windowStreamReason?: WindowStreamReason | null | undefined;
  readonly controllerKind: ControllerKind;
  readonly gcode: string;
}): ReadonlyArray<string> {
  if (!args.connected || args.jobStreamHost !== 'window') return [];
  const firmware = scannedFirmware(args.controllerKind);
  if (firmware === null) return [];
  const finding = findStoppedHeadPower(args.gcode, firmware);
  if (finding === null) return [];
  const route = WORKER_ROUTE[args.windowStreamReason ?? 'no-worker'];
  return [`${HEAD} ${riskSentence(finding.kind, finding.line)} ${route}`];
}

/** The same warning, read from the live laser session at review time. */
export function liveWindowStreamLitStopWarnings(
  live: Pick<
    LaserState,
    'connection' | 'jobStreamHost' | 'windowStreamReason' | 'activeControllerKind'
  >,
  gcode: string,
): ReadonlyArray<string> {
  return detectWindowStreamLitStopWarnings({
    connected: live.connection.kind === 'connected',
    jobStreamHost: live.jobStreamHost,
    windowStreamReason: live.windowStreamReason,
    controllerKind: live.activeControllerKind,
    gcode,
  });
}

/** Puts the lit-stop warning first, ahead of every finding added before it,
 *  whoever added it (ADR-676 decision 5 and Amendment 5). */
export function leadWithLitStop<M extends { readonly warnings: ReadonlyArray<string> }>(
  model: M,
  litStop: ReadonlyArray<string>,
): M {
  if (litStop.length === 0) return model;
  const rest = model.warnings.filter((warning) => !litStop.includes(warning));
  return { ...model, warnings: [...litStop, ...rest] };
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
